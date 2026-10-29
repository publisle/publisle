import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import {
  mkdtemp,
  writeFile,
  rm,
  readFile,
  chmod,
  readdir,
  stat,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  LIMITS,
  TEMPLATES,
  availableTemplates,
  ServiceError,
  validateRequest,
} from "./limits.mjs";
import { Admission } from "./queue.mjs";
import { fetchImages } from "./images.mjs";
import { runWorker } from "./worker.mjs";

const execute = promisify(execFile);

const loopback = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// Dual-stack sockets present IPv4 peers in mapped form; normalize so exact and
// CIDR trust checks apply to one canonical spelling.
export function normalizeAddress(address) {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/u.exec(address ?? "");
  return mapped ? mapped[1] : (address ?? "");
}

function ipv4Value(address) {
  const octets = address.split(".");
  if (octets.length !== 4) return undefined;
  let value = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/u.test(octet)) return undefined;
    const number = Number(octet);
    if (number > 255) return undefined;
    value = value * 256 + number;
  }
  return value;
}

// Trust is explicit: exact IP entries (any family) plus IPv4 CIDR ranges, which
// cover Docker bridge networks. Unparsable entries are ignored, never trusted.
export function trustedProxyCheck(entries) {
  const exact = new Set(loopback);
  const ranges = [];
  for (const entry of entries ?? []) {
    const [base, bits] = String(entry).split("/");
    if (isIP(base) === 6) exact.add(base);
    else if (isIP(base) === 4) {
      const size = bits === undefined ? 32 : Number(bits);
      const network = ipv4Value(base);
      if (
        network === undefined ||
        !Number.isInteger(size) ||
        size < 0 ||
        size > 32
      )
        continue;
      const mask = size === 0 ? 0 : (0xffffffff << (32 - size)) >>> 0;
      ranges.push({ network: (network & mask) >>> 0, mask });
    }
  }
  return (address) => {
    const normalized = normalizeAddress(address);
    if (exact.has(normalized)) return true;
    const value = isIP(normalized) === 4 ? ipv4Value(normalized) : undefined;
    return (
      value !== undefined &&
      ranges.some(({ network, mask }) => (value & mask) >>> 0 === network)
    );
  };
}

// The client is the rightmost untrusted X-Forwarded-For entry; a direct peer is
// used when it is not itself a trusted proxy. Invalid entries are skipped, and
// an all-trusted chain falls back to the peer so limits cannot be bypassed by
// header forgery.
export function clientAddress(peer, forwarded, isTrusted) {
  const normalized = normalizeAddress(peer) || "unknown";
  if (!isTrusted(normalized)) return normalized;
  if (typeof forwarded === "string")
    for (const part of forwarded.split(",").reverse()) {
      const candidate = normalizeAddress(part.trim());
      if (candidate && isIP(candidate) !== 0 && !isTrusted(candidate))
        return candidate;
    }
  return normalized;
}

// Systemd delegates user-manager processes into child scopes (init.scope,
// app.slice), leaving the service cgroup's own procs file empty. Population is
// therefore checked across the delegated subtree.
export async function cgroupSubtreePopulated(directory) {
  let procs = "";
  try {
    procs = await readFile(join(directory, "cgroup.procs"), "utf8");
  } catch {
    procs = "";
  }
  if (procs.trim().length > 0) return true;
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries)
    if (
      entry.isDirectory() &&
      (await cgroupSubtreePopulated(join(directory, entry.name)))
    )
      return true;
  return false;
}

export async function checkReadiness(
  image,
  allowUnverified = false,
  native = undefined,
) {
  if (!/^sha256:[a-f0-9]{64}$/.test(image ?? "")) return false;
  try {
    await execute("docker", ["image", "inspect", image], {
      timeout: 5000,
      maxBuffer: 262144,
    });
    if (allowUnverified) return process.env.NODE_ENV !== "production";
    const cgroup = (await readFile("/proc/self/cgroup", "utf8"))
      .trim()
      .split("::")[1];
    if (
      !cgroup?.includes("/publisle-pdf.slice/") ||
      process.env.DOCKER_HOST !==
        `unix:///run/user/${process.getuid()}/docker.sock`
    )
      return false;
    const base = `/sys/fs/cgroup${cgroup.slice(0, cgroup.indexOf("/publisle-pdf.slice/") + "/publisle-pdf.slice".length)}`;
    const verification = JSON.parse(
      await readFile(
        native?.verificationFile ??
          process.env.PDF_VERIFICATION_FILE ??
          "/etc/publisle-pdf-verified.json",
        "utf8",
      ),
    );
    if (
      verification.image !== image ||
      verification.passed !== true ||
      verification.aggregateCpu !== 0.5 ||
      verification.aggregateMemoryMiB !== 512 ||
      (native &&
        native.templates.some(
          (id) =>
            !verification.native?.templates?.some(
              (record) =>
                record.id === id &&
                record.contentParity === true &&
                (record.layoutReviewed === true ||
                  record.layoutChecksPassed === true) &&
                record.pdfUa2 === true &&
                record.uncachedSamples >= 30 &&
                record.uncachedP95Ms < 5000,
            ),
        )) ||
      TEMPLATES.filter(
        (template) => !native || native.templates.includes(template.id),
      ).some(
        (template) =>
          !verification.samples?.some(
            (sample) =>
              sample.template === template.id &&
              (!native || sample.engine === "rust") &&
              sample.pdfBytes > 0 &&
              !sample.failure,
          ),
      )
    )
      return false;
    const [memory, swap, cpu, runtime] = await Promise.all([
      readFile(`${base}/memory.max`, "utf8"),
      readFile(`${base}/memory.swap.max`, "utf8"),
      readFile(`${base}/cpu.max`, "utf8"),
      cgroupSubtreePopulated(`${base}/user@${process.getuid()}.service`),
    ]);
    const [quota, period] = cpu.trim().split(/\s+/).map(Number);
    const info = JSON.parse(
      (
        await execute("docker", ["info", "--format", "{{json .}}"], {
          timeout: 5000,
          maxBuffer: 262144,
        })
      ).stdout,
    );
    return (
      Number(memory.trim()) <= 512 * 1024 * 1024 &&
      Number(swap.trim()) === 0 &&
      quota > 0 &&
      quota / period <= 0.5 &&
      runtime === true &&
      info.CgroupVersion === "2" &&
      // Both rootless cgroup drivers keep containers inside the delegated
      // daemon subtree; the populated-subtree check above is what actually
      // proves slice containment.
      ["systemd", "cgroupfs", "none"].includes(info.CgroupDriver) === true &&
      info.SecurityOptions?.some((value) => value.includes("rootless")) === true
    );
  } catch {
    return false;
  }
}

// Content-addressed PDF cache, opt-in via PDF_CACHE_DIR. Keyed by the
// validated request, so identical repeat compiles skip every container run.
// Remote figure assets are fetched during compilation; a cached PDF is only
// as fresh as its TTL, which is why the cache is off unless explicitly
// enabled and entries expire quickly by default.
const CACHE_PDF_TTL_MS = Number(process.env.PDF_CACHE_TTL_MS ?? 3_600_000);
const CACHE_TOTAL_BYTES = 256 * 1024 * 1024;

function cacheKey(request, image) {
  return createHash("sha256")
    .update(JSON.stringify({ request, image }))
    .digest("hex");
}

async function readCachedPdf(cacheDirectory, key) {
  const base = join(cacheDirectory, key);
  try {
    const [info, pdf, diagnostics] = await Promise.all([
      stat(`${base}.pdf`),
      readFile(`${base}.pdf`),
      readFile(`${base}.json`, "utf8").then(
        (value) => JSON.parse(value),
        () => [],
      ),
    ]);
    if (Date.now() - info.mtimeMs > CACHE_PDF_TTL_MS) return undefined;
    if (pdf.subarray(0, 5).toString() !== "%PDF-") return undefined;
    return { pdf, diagnostics };
  } catch {
    return undefined;
  }
}

async function storeCachedPdf(cacheDirectory, key, result) {
  const base = join(cacheDirectory, key);
  try {
    await writeFile(`${base}.pdf`, result.pdf, { flag: "wx" });
    await writeFile(`${base}.json`, JSON.stringify(result.diagnostics ?? []), {
      flag: "wx",
    });
    let entries = await readdir(cacheDirectory);
    let total = 0;
    const sized = [];
    for (const entry of entries) {
      if (!entry.endsWith(".pdf")) continue;
      const info = await stat(join(cacheDirectory, entry));
      total += info.size;
      sized.push({ entry, mtime: info.mtimeMs, size: info.size });
    }
    if (total > CACHE_TOTAL_BYTES) {
      sized.sort((a, b) => a.mtime - b.mtime);
      for (const item of sized) {
        if (total <= CACHE_TOTAL_BYTES) break;
        if (item.entry === `${key}.pdf`) continue;
        await rm(join(cacheDirectory, item.entry), { force: true });
        await rm(join(cacheDirectory, `${item.entry.slice(0, -4)}.json`), {
          force: true,
        });
        total -= item.size;
      }
    }
  } catch {
    /* The cache is best-effort; compilation results are never dropped. */
  }
}

export async function compileJob(request, signal, options) {
  // One shared deadline bounds the native attempt and the single legacy retry.
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(LIMITS.jobMs)]);
  try {
    return await compileAttempt(request, deadline, options);
  } catch (error) {
    // A wide table or an overfull line will not succeed by switching engines.
    // Rethrow so the client receives 422 JSON with the native diagnostics
    // instead of waiting out a LuaLaTeX attempt that fails the same way.
    if (
      request.engine !== "rust" ||
      deadline.aborted ||
      !options.image ||
      error.code === "engine-unavailable" ||
      error.code === "layout-overflow" ||
      error.code === "invalid-table"
    )
      throw error;
    try {
      const result = await compileAttempt(
        { ...request, engine: "lualatex" },
        deadline,
        options,
        { fallback: true },
      );
      return {
        ...result,
        diagnostics: [
          ...(error.diagnostics ?? []),
          {
            code: "native-engine-fallback",
            message:
              "The fast engine failed; this PDF was compiled with LuaLaTeX.",
          },
          ...(result.diagnostics ?? []),
        ],
      };
    } catch (fallbackError) {
      fallbackError.diagnostics = [
        ...(error.diagnostics ?? []),
        ...(fallbackError.diagnostics ?? []),
      ];
      throw fallbackError;
    }
  }
}

async function compileAttempt(request, signal, options, attempt = {}) {
  const image = request.engine === "rust" ? options.nativeImage : options.image;
  if (
    request.engine === "rust" &&
    (!image || !options.nativeTemplates?.includes(request.template))
  )
    throw new ServiceError(
      "engine-unavailable",
      "The native compiler has not been verified for this template.",
      400,
    );
  const worker = options.runWorker ?? runWorker;
  const directory = await mkdtemp(
    join(options.jobDirectory ?? tmpdir(), "publisle-pdf-"),
  );
  // Workers run with all capabilities dropped, so container-root cannot read
  // owner-only files on rootful daemons. The 0700 job-directory parent still
  // gates access; the mounted job directory itself must stay traversable.
  await chmod(directory, 0o755);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(LIMITS.jobMs)]);
  const started = performance.now();
  let resultCode = "ok";
  const timings = {};
  const measured = async (key, action) => {
    const begin = performance.now();
    try {
      return await action();
    } finally {
      timings[key] = Math.round(performance.now() - begin);
    }
  };
  try {
    await writeFile(join(directory, "request.json"), JSON.stringify(request), {
      flag: "wx",
      mode: 0o644,
    });
    const stageAssets = async (prepared) => {
      if (
        typeof prepared.timings?.prepareMs === "number" &&
        Number.isFinite(prepared.timings.prepareMs) &&
        prepared.timings.prepareMs >= 0
      ) {
        timings.prepareMs = Math.round(prepared.timings.prepareMs);
        timings.prepareStartupAndCleanupMs = Math.max(
          0,
          timings.prepareWorkerMs - timings.prepareMs,
        );
      }
      if (
        !Array.isArray(prepared.sources) ||
        prepared.sources.some((source) => typeof source !== "string")
      )
        throw new Error("Invalid worker output");
      const assets = await measured("fetchMs", () =>
        fetchImages(
          prepared.sources,
          directory,
          deadline,
          options.assetBase,
          options.imageDependencies,
        ),
      );
      await writeFile(
        join(directory, "prepared.json"),
        JSON.stringify({ document: prepared.document, assets }),
        { flag: "wx", mode: 0o644 },
      );
    };
    let output;
    if (request.engine === "rust") {
      output = await measured("nativeSessionMs", () =>
        worker(
          image,
          directory,
          "session",
          deadline,
          undefined,
          async (prepared) => {
            timings.prepareWorkerMs = Math.round(performance.now() - started);
            await stageAssets(prepared);
            await writeFile(join(directory, "ready"), "", {
              flag: "wx",
              mode: 0o644,
            });
          },
        ),
      );
    } else {
      const prepared = JSON.parse(
        (
          await measured("prepareWorkerMs", () =>
            worker(image, directory, "prepare", deadline),
          )
        ).toString("utf8"),
      );
      await stageAssets(prepared);
      output = await measured("compileWorkerMs", () =>
        worker(image, directory, "compile", deadline),
      );
    }
    const line = output.indexOf(10);
    if (line < 0 || line > 16384) throw new Error("Invalid worker output");
    const metadata = JSON.parse(output.subarray(0, line).toString("utf8"));
    const pdf = output.subarray(line + 1);
    for (const [key, value] of Object.entries(metadata.timings ?? {}))
      if (
        /^[a-zA-Z]{1,30}$/u.test(key) &&
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0
      )
        timings[key] = Math.round(value);
    if (timings.workerMs !== undefined && timings.compileWorkerMs !== undefined)
      timings.compileStartupAndCleanupMs = Math.max(
        0,
        timings.compileWorkerMs - timings.workerMs,
      );
    if (!metadata.ok || pdf.subarray(0, 5).toString() !== "%PDF-")
      throw new Error("Invalid worker output");
    return { pdf, diagnostics: metadata.diagnostics };
  } catch (error) {
    resultCode = signal.aborted
      ? "cancelled"
      : deadline.aborted
        ? "timeout"
        : (error.code ?? "compilation-failed");
    if (deadline.aborted && !signal.aborted)
      throw new ServiceError(
        "timeout",
        "PDF compilation exceeded its time limit.",
        504,
      );
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
    options.onTimings?.(timings);
    console.log(
      JSON.stringify({
        event: "pdf-job",
        code: resultCode,
        durationMs: Math.round(performance.now() - started),
        timings,
        ...(attempt.fallback ? { fallback: true } : {}),
      }),
    );
  }
}

export function createApi(options = {}) {
  const admission = new Admission(options.limits ?? LIMITS);
  const isTrustedProxy = trustedProxyCheck(options.trustedProxies);
  const allowedOrigins = new Set(options.origins ?? ["https://publisle.xyz"]);
  let ready = options.ready ?? false;
  const controllers = new Set();
  const json = (response, status, payload) => {
    if (response.destroyed) return;
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
    });
    response.end(body);
  };
  const server = createServer(
    { requestTimeout: 45000, headersTimeout: 10000, maxHeaderSize: 8192 },
    (request, response) => {
      response.setHeader("x-content-type-options", "nosniff");
      response.setHeader("cache-control", "no-store");
      const origin = request.headers.origin;
      if (origin && !allowedOrigins.has(origin)) {
        json(response, 403, {
          ok: false,
          code: "origin-denied",
          message: "Origin is not allowed.",
        });
        return;
      }
      if (origin) {
        response.setHeader("access-control-allow-origin", origin);
        response.setHeader("vary", "Origin");
        response.setHeader(
          "access-control-expose-headers",
          "Retry-After, X-Publisle-Diagnostics",
        );
      }
      if (request.method === "OPTIONS") {
        response.writeHead(204, {
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "Content-Type, Accept",
          "access-control-max-age": "600",
        });
        response.end();
        return;
      }
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      if (request.method === "GET" && pathname === "/health") {
        json(response, 200, {
          status: "ok",
          service: "publisle-api",
          services: { pdf: ready },
        });
        return;
      }
      if (request.method === "GET" && pathname === "/pdf/capabilities") {
        json(response, 200, {
          enabled: ready,
          templates: availableTemplates(
            options.nativeImage ? options.nativeTemplates : [],
          ),
          requiredMetadata: ["title", "authors"],
          limits: LIMITS,
        });
        return;
      }
      if (request.method === "GET" && pathname === "/") {
        json(response, 200, {
          service: "publisle-api",
          endpoints: [
            "GET /health",
            "GET /pdf/capabilities",
            "POST /pdf/compile",
          ],
        });
        return;
      }
      if (request.method !== "POST" || pathname !== "/pdf/compile") {
        json(response, 404, {
          ok: false,
          code: "not-found",
          message: "Not found.",
        });
        return;
      }
      if (!ready) {
        json(response, 503, {
          ok: false,
          code: "unavailable",
          message: "PDF compilation is unavailable.",
        });
        request.resume();
        return;
      }
      const controller = new AbortController();
      controllers.add(controller);
      response.on("close", () => controller.abort());
      void (async () => {
        let release;
        const respondWithPdf = (result) => {
          if (request.headers.accept?.includes("application/pdf")) {
            const diagnostics = Buffer.from(
              JSON.stringify(result.diagnostics ?? []),
            ).toString("base64");
            response.writeHead(200, {
              "content-type": "application/pdf",
              "content-disposition": 'attachment; filename="publisle.pdf"',
              "content-length": result.pdf.length,
              "x-publisle-diagnostics":
                diagnostics.length <= 8192 ? diagnostics : "W10=",
            });
            response.end(result.pdf);
          } else
            json(response, 200, {
              ok: true,
              pdfBase64: result.pdf.toString("base64"),
              diagnostics: result.diagnostics ?? [],
            });
        };
        try {
          if (
            request.headers["content-type"]?.split(";")[0]?.trim() !==
            "application/json"
          )
            throw new ServiceError(
              "invalid-content-type",
              "Expected application/json.",
              415,
            );
          if (
            Number(request.headers["content-length"] ?? 0) > LIMITS.requestBytes
          )
            throw new ServiceError(
              "request-limit",
              "Editor source exceeds 256 KiB.",
              413,
            );
          let ip = clientAddress(
            request.socket.remoteAddress,
            request.headers["x-forwarded-for"],
            isTrustedProxy,
          );
          const chunks = [];
          let size = 0;
          for await (const chunk of request) {
            size += chunk.length;
            if (size > LIMITS.requestBytes)
              throw new ServiceError(
                "request-limit",
                "Editor source exceeds 256 KiB.",
                413,
              );
            chunks.push(chunk);
          }
          let value;
          try {
            value = JSON.parse(
              new TextDecoder("utf-8", { fatal: true }).decode(
                Buffer.concat(chunks),
              ),
            );
          } catch {
            throw new ServiceError(
              "invalid-request",
              "Invalid JSON source.",
              400,
            );
          }
          const input = validateRequest(
            value,
            options.nativeImage ? options.nativeTemplates : [],
          );
          // Cache hits never consume the per-IP quota: identical repeat
          // exports stay free, which keeps launch-day demos workable.
          if (options.pdfCacheDirectory) {
            const cached = await readCachedPdf(
              options.pdfCacheDirectory,
              cacheKey(
                input,
                input.engine === "rust" ? options.nativeImage : options.image,
              ),
            );
            if (cached) {
              console.log(
                JSON.stringify({
                  event: "pdf-job",
                  code: "cache-hit",
                  durationMs: 0,
                }),
              );
              respondWithPdf({
                pdf: cached.pdf,
                diagnostics: [
                  ...cached.diagnostics,
                  {
                    code: "pdf-cache-hit",
                    message:
                      "An identical document was compiled recently; the cached PDF was served.",
                  },
                ],
              });
              return;
            }
          }
          const admittedAt = performance.now();
          release = await admission.acquire(ip, controller.signal);
          console.log(
            JSON.stringify({
              event: "pdf-admission",
              queueMs: Math.round(performance.now() - admittedAt),
            }),
          );
          const result = await (
            options.compile ??
            ((job, signal) => compileJob(job, signal, options))
          )(input, controller.signal);
          if (controller.signal.aborted) return;
          if (options.pdfCacheDirectory)
            await storeCachedPdf(
              options.pdfCacheDirectory,
              cacheKey(
                input,
                input.engine === "rust" ? options.nativeImage : options.image,
              ),
              result,
            );
          respondWithPdf(result);
        } catch (error) {
          if (!controller.signal.aborted) {
            if (error.status === 429) response.setHeader("retry-after", "60");
            json(response, error.status ?? 422, {
              ok: false,
              code: error.code ?? "compilation-failed",
              diagnostics: error.diagnostics ?? [],
              message:
                error instanceof ServiceError
                  ? error.message
                  : "Could not compile this document. Check image URLs, source, and service limits.",
            });
          }
        } finally {
          request.resume();
          release?.();
          controllers.delete(controller);
        }
      })();
    },
  );
  server.maxConnections = 32;
  return {
    server,
    setReady(value) {
      ready = value;
    },
    shutdown() {
      ready = false;
      for (const controller of controllers) controller.abort();
      server.close();
      server.closeAllConnections();
    },
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  // Log and still terminate. A listener replaces Node's default crash path,
  // so exiting is what keeps the process from continuing after the failure.
  const logProcessFailure = (event, reason) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    console.log(
      JSON.stringify({
        event,
        message: error.message,
        ...(error.stack ? { stack: error.stack } : {}),
      }),
    );
  };
  process.on("uncaughtException", (error) => {
    logProcessFailure("uncaughtException", error);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logProcessFailure("unhandledRejection", reason);
    process.exit(1);
  });
  const enabled = process.env.PDF_ENABLED === "true";
  const image = process.env.PDF_WORKER_IMAGE;
  const localQa = process.env.PDF_LOCAL_QA === "true";
  const nativeTemplates = (process.env.PDF_NATIVE_TEMPLATES ?? "")
    .split(",")
    .filter(Boolean);
  if (
    nativeTemplates.some(
      (id) => !TEMPLATES.some((template) => template.id === id),
    )
  )
    throw new Error("Unknown PDF_NATIVE_TEMPLATES entry.");
  const nativeImage = process.env.PDF_NATIVE_WORKER_IMAGE;
  const nativeVerification = {
    templates: nativeTemplates,
    verificationFile:
      process.env.PDF_NATIVE_VERIFICATION_FILE ??
      "/etc/publisle-native-pdf-verified.json",
  };
  const bind = process.env.PDF_BIND ?? "127.0.0.1";
  if (isIP(bind) === 0)
    throw new Error("PDF_BIND must be an IP address for the API listener.");
  const options = {
    image,
    nativeImage:
      nativeTemplates.length &&
      (await checkReadiness(nativeImage, localQa, nativeVerification))
        ? nativeImage
        : undefined,
    nativeTemplates,
    assetBase: process.env.PDF_ASSET_BASE ?? "https://publisle.xyz/",
    jobDirectory: process.env.PDF_JOB_DIRECTORY,
    pdfCacheDirectory: process.env.PDF_CACHE_DIR
      ? join(process.env.PDF_CACHE_DIR, "pdfs")
      : undefined,
    trustedProxies: (process.env.PDF_TRUST_PROXY ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
    origins: (process.env.PDF_ORIGINS ?? "https://publisle.xyz").split(","),
    ready: enabled && (await checkReadiness(image, localQa)),
  };
  if (options.pdfCacheDirectory)
    await mkdir(options.pdfCacheDirectory, { recursive: true });
  const api = createApi(options);
  api.server.listen(Number(process.env.PORT ?? 8787), bind, () =>
    console.log(`Publisle API ready (PDF: ${options.ready})`),
  );
  const timer = setInterval(() => {
    void checkReadiness(image, localQa).then((ready) =>
      api.setReady(enabled && ready),
    );
  }, 30000);
  timer.unref();
  for (const event of ["SIGTERM", "SIGINT"])
    process.once(event, () => {
      clearInterval(timer);
      api.shutdown();
    });
}

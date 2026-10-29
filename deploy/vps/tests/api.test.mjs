import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import {
  mkdtemp,
  readdir,
  rm,
  mkdir,
  writeFile,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Admission } from "../queue.mjs";
import { LIMITS, validateRequest, availableTemplates } from "../limits.mjs";
import { imageDestination, isPublicAddress, fetchImages } from "../images.mjs";
import {
  createApi,
  compileJob,
  checkReadiness,
  cgroupSubtreePopulated,
  clientAddress,
  trustedProxyCheck,
} from "../server.mjs";
import { workerArguments } from "../worker.mjs";

test("native engines are advertised and accepted only for explicitly verified templates", () => {
  assert.throws(() => validateRequest({ markdown: "x", engine: "rust" }));
  assert.equal(
    validateRequest({ markdown: "x", engine: "rust" }, ["article"]).engine,
    "rust",
  );
  assert.throws(() =>
    validateRequest(
      { markdown: "x", template: "ieee-journal", engine: "rust" },
      ["article"],
    ),
  );
  assert.deepEqual(
    availableTemplates().find((template) => template.id === "article").engines,
    ["lualatex", "pdflatex"],
  );
  assert.deepEqual(
    availableTemplates(["article"]).find(
      (template) => template.id === "article",
    ).engines,
    ["lualatex", "pdflatex", "rust"],
  );
});

test("native jobs use one sandbox session and stage assets before releasing compilation", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "publisle-native-session-test-"),
  );
  const image = `sha256:${"a".repeat(64)}`;
  let calls = 0;
  try {
    const result = await compileJob(
      validateRequest({ markdown: "hello", engine: "rust" }, ["article"]),
      new AbortController().signal,
      {
        nativeImage: image,
        nativeTemplates: ["article"],
        jobDirectory: directory,
        runWorker: async (
          selected,
          job,
          action,
          _signal,
          _onContainer,
          onPrepared,
        ) => {
          calls++;
          assert.equal(selected, image);
          assert.equal(action, "session");
          await onPrepared({
            document: { schemaVersion: 1, blocks: [] },
            sources: [],
            timings: { prepareMs: 1 },
          });
          assert.equal(await readFile(join(job, "ready"), "utf8"), "");
          assert.deepEqual(
            JSON.parse(await readFile(join(job, "prepared.json"), "utf8"))
              .assets,
            [],
          );
          return Buffer.from(
            '{"ok":true,"diagnostics":[],"timings":{"compilerMs":2}}\n%PDF-2.0\nnative',
          );
        },
      },
    );
    assert.equal(calls, 1);
    assert.ok(result.pdf.toString().startsWith("%PDF-2.0"));
    assert.deepEqual(await readdir(directory), []);
    await assert.rejects(
      compileJob(
        { engine: "rust", template: "article" },
        new AbortController().signal,
        { jobDirectory: directory },
      ),
      /not been verified/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("request contract restricts templates, engines and metadata", () => {
  for (const value of [
    null,
    {},
    { markdown: "x", document: {} },
    { markdown: 5 },
    { markdown: "x", template: "../../evil" },
    { markdown: "x", template: "acm-journal", engine: "lualatex" },
    { markdown: "x", data: { pdfUa: false } },
  ])
    assert.throws(() => validateRequest(value));
  assert.equal(
    validateRequest({ markdown: "x", template: "elsevier-author-date" }).style,
    "author-date",
  );
  assert.equal(
    validateRequest({ document: {}, template: "article-arabic" }).engine,
    "lualatex",
  );
});

test("SSRF guard rejects private, reserved, mapped and mixed DNS destinations", async () => {
  for (const address of [
    "127.0.0.1",
    "10.1.1.1",
    "169.254.169.254",
    "100.64.1.1",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fe80::1",
    "fc00::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "garbage",
  ])
    assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("93.184.216.34"), true);
  assert.equal(isPublicAddress("2606:4700::1111"), true);
  const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
  for (const source of [
    "http://example.com/x",
    "file:///etc/passwd",
    "https://u:p@example.com/x",
    "https://example.com:8443/x",
    "https://2130706433/x",
    "https://[::1]/x",
  ])
    await assert.rejects(
      imageDestination(source, "https://publisle.xyz", publicDns),
    );
  await assert.rejects(
    imageDestination(
      "https://example.com/x",
      "https://publisle.xyz",
      async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.1", family: 4 },
      ],
    ),
  );
  const checked = await imageDestination(
    "/favicon.svg",
    "https://publisle.xyz/",
    publicDns,
  );
  assert.equal(checked.url.href, "https://publisle.xyz/favicon.svg");
  assert.equal(checked.address, "93.184.216.34");
});

test("image acquisition revalidates redirects and deduplicates bounded files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pdf-images-test-"));
  try {
    let calls = 0;
    const dependencies = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      download: async () => {
        calls++;
        return { bytes: Buffer.from("png"), mime: "image/png" };
      },
    };
    const assets = await fetchImages(
      ["https://example.com/a", "https://example.com/a"],
      directory,
      new AbortController().signal,
      "https://publisle.xyz",
      dependencies,
    );
    assert.equal(calls, 1);
    assert.equal(assets.length, 1);
    assert.deepEqual(await readdir(directory), ["image-0.input"]);
    await assert.rejects(
      fetchImages(
        ["https://example.com/a"],
        directory,
        new AbortController().signal,
        "https://publisle.xyz",
        {
          ...dependencies,
          download: async () => ({ location: "https://127.0.0.1/private" }),
        },
      ),
    );
    await assert.rejects(
      fetchImages(
        ["https://example.com/a"],
        directory,
        new AbortController().signal,
        "https://publisle.xyz",
        {
          ...dependencies,
          download: async () => ({
            bytes: Buffer.alloc(LIMITS.imageBytes + 1),
            mime: "image/png",
          }),
        },
      ),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("admission serializes work, bounds queue, releases cancellation and enforces quotas", async () => {
  const gate = new Admission({ ...LIMITS, queueMs: 50 });
  const signal = new AbortController().signal;
  const first = await gate.acquire("a", signal);
  await assert.rejects(gate.acquire("a", signal), { status: 429 });
  const second = gate.acquire("b", signal);
  const cancelled = new AbortController();
  const third = gate.acquire("c", cancelled.signal);
  await assert.rejects(gate.acquire("d", signal), { status: 429 });
  cancelled.abort(new Error("cancelled"));
  await assert.rejects(third, /cancelled/);
  first();
  const release = await second;
  const timeout = gate.acquire("e", signal);
  await assert.rejects(timeout, { status: 429 });
  release();
  for (let i = 1; i < LIMITS.attempts; i++) (await gate.acquire("a", signal))();
  await assert.rejects(gate.acquire("a", signal), { status: 429 });
  assert.equal(gate.pending.length, 0);
  assert.equal(gate.active, false);
});

test("cache hits skip admission so repeat exports never consume the quota", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pdf-cache-quota-test-"));
  const cache = join(directory, "cache");
  await mkdir(cache);
  const pdf = Buffer.from("%PDF-1.7\nfixture");
  let compiles = 0;
  const api = createApi({
    ready: true,
    image: `sha256:${"1".repeat(64)}`,
    pdfCacheDirectory: cache,
    limits: { ...LIMITS, attempts: 1 },
    compile: async () => {
      compiles++;
      return { pdf, diagnostics: [] };
    },
  });
  api.server.listen(0, "127.0.0.1");
  await once(api.server, "listening");
  const base = `http://127.0.0.1:${api.server.address().port}`;
  const send = (markdown) =>
    fetch(`${base}/pdf/compile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/pdf",
      },
      body: JSON.stringify({ markdown }),
    });
  const body =
    "---\ntitle: Test\nauthors:\n  - name: Ada\n---\n\nRepeatable body";
  try {
    const first = await send(body);
    assert.equal(first.status, 200);
    assert.equal(compiles, 1);
    const repeat = await send(body);
    assert.equal(repeat.status, 200);
    assert.equal(await repeat.text(), pdf.toString());
    assert.equal(compiles, 1);
    const different = await send(`${body} Changed`);
    assert.equal(different.status, 429);
    assert.ok(different.headers.get("retry-after"));
    assert.equal(compiles, 1);
  } finally {
    api.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("worker sandbox is immutable, bounded and has no network", async () => {
  const args = workerArguments(
    `sha256:${"a".repeat(64)}`,
    "test",
    "/tmp/job",
    "compile",
  );
  for (const flag of [
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--memory=448m",
    "--memory-swap=448m",
    "--cpus=0.5",
  ])
    assert.ok(args.includes(flag));
  assert.throws(() => workerArguments("latest", "test", "/tmp/job", "compile"));
  assert.equal(await checkReadiness("latest"), false);
});

test("client identity takes the rightmost untrusted forwarded hop", () => {
  const isTrusted = trustedProxyCheck(["172.16.0.0/12", "fd00::1", "junk"]);
  assert.equal(
    clientAddress("203.0.113.7", undefined, isTrusted),
    "203.0.113.7",
  );
  // A direct (untrusted) peer ignores forged forwarding headers entirely.
  assert.equal(
    clientAddress("203.0.113.7", "198.51.100.9", isTrusted),
    "203.0.113.7",
  );
  assert.equal(
    clientAddress("172.18.0.5", "198.51.100.9, 172.18.0.5", isTrusted),
    "198.51.100.9",
  );
  // An undeclared intermediate hop is treated as the client (conservative);
  // declaring every proxy hop restores the original visitor address.
  assert.equal(
    clientAddress("172.18.0.5", "203.0.113.1, 10.0.0.1", isTrusted),
    "10.0.0.1",
  );
  assert.equal(
    clientAddress(
      "172.18.0.5",
      "203.0.113.1, 10.0.0.1",
      trustedProxyCheck(["172.16.0.0/12", "10.0.0.0/8"]),
    ),
    "203.0.113.1",
  );
  // Mapped peers normalize before the trust decision.
  assert.equal(
    clientAddress("::ffff:172.18.0.5", "198.51.100.9", isTrusted),
    "198.51.100.9",
  );
  assert.equal(
    clientAddress("::ffff:198.51.100.9", "203.0.113.1", isTrusted),
    "198.51.100.9",
  );
  // Invalid entries are skipped, never adopted; a fully trusted chain falls
  // back to the peer so limits cannot be bypassed.
  assert.equal(
    clientAddress("172.18.0.5", "not-an-address, 198.51.100.9", isTrusted),
    "198.51.100.9",
  );
  assert.equal(
    clientAddress(
      "172.18.0.5",
      "10.0.0.1, 172.18.0.5",
      trustedProxyCheck(["172.16.0.0/12", "10.0.0.0/8"]),
    ),
    "172.18.0.5",
  );
  assert.equal(
    clientAddress("fd00::1", "198.51.100.9", isTrusted),
    "198.51.100.9",
  );
  assert.equal(trustedProxyCheck([])("127.0.0.1"), true);
  assert.equal(trustedProxyCheck([])("::ffff:127.0.0.1"), true);
  assert.equal(trustedProxyCheck([])("172.18.0.5"), false);
  assert.equal(trustedProxyCheck(["172.16.0.0/12"])("172.31.255.255"), true);
  assert.equal(trustedProxyCheck(["172.16.0.0/12"])("172.32.0.1"), false);
});

test("readiness detects the delegated user-manager subtree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pdf-cgroup-test-"));
  try {
    const joinRelative = (...parts) => join(directory, ...parts);
    await mkdir(joinRelative("user@999.service", "init.scope"), {
      recursive: true,
    });
    await mkdir(
      joinRelative("user@999.service", "app.slice", "docker.service"),
      {
        recursive: true,
      },
    );
    // Nothing populated anywhere yet.
    assert.equal(
      await cgroupSubtreePopulated(joinRelative("user@999.service")),
      false,
    );
    // Systemd places the manager in init.scope and the daemon deeper.
    await writeFile(
      joinRelative("user@999.service", "init.scope", "cgroup.procs"),
      "6906\n",
    );
    assert.equal(
      await cgroupSubtreePopulated(joinRelative("user@999.service")),
      true,
    );
    await writeFile(
      joinRelative("user@999.service", "init.scope", "cgroup.procs"),
      "",
    );
    assert.equal(
      await cgroupSubtreePopulated(joinRelative("user@999.service")),
      false,
    );
    await writeFile(
      joinRelative(
        "user@999.service",
        "app.slice",
        "docker.service",
        "cgroup.procs",
      ),
      "8001\n8002\n",
    );
    assert.equal(
      await cgroupSubtreePopulated(joinRelative("user@999.service")),
      true,
    );
    // Missing trees are simply unpopulated, never a crash.
    assert.equal(await cgroupSubtreePopulated(joinRelative("absent")), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("API serves binary and legacy PDFs, CORS, capability and error states", async () => {
  const pdf = Buffer.from("%PDF-1.7\nfixture");
  const api = createApi({
    ready: true,
    compile: async () => ({ pdf, diagnostics: [] }),
  });
  api.server.listen(0, "127.0.0.1");
  await once(api.server, "listening");
  const base = `http://127.0.0.1:${api.server.address().port}`;
  const send = (value, headers = {}) =>
    fetch(`${base}/pdf/compile`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(value),
    });
  try {
    assert.equal(
      (await (await fetch(`${base}/health`)).json()).services.pdf,
      true,
    );
    assert.equal(
      (await (await fetch(`${base}/pdf/capabilities`)).json()).templates.length,
      7,
    );
    const preflight = await fetch(`${base}/pdf/compile`, {
      method: "OPTIONS",
      headers: { origin: "https://publisle.xyz" },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get("access-control-allow-origin"),
      "https://publisle.xyz",
    );
    assert.equal(
      (await send({ markdown: "x" }, { origin: "https://evil.example" }))
        .status,
      403,
    );
    const binary = await send({ markdown: "x" }, { accept: "application/pdf" });
    assert.equal(binary.headers.get("content-type"), "application/pdf");
    assert.equal(await binary.text(), pdf.toString());
    const legacy = await send({ markdown: "x" });
    assert.equal((await legacy.json()).pdfBase64, pdf.toString("base64"));
    assert.equal((await send({})).status, 400);
    assert.equal(
      (await send({ markdown: "x" }, { "content-type": "text/plain" })).status,
      415,
    );
    assert.equal(
      (await send({ markdown: "x".repeat(LIMITS.requestBytes) })).status,
      413,
    );
    api.setReady(false);
    assert.equal((await send({ markdown: "x" })).status, 503);
  } finally {
    api.shutdown();
  }
});

test("PDF compilation converts images in the compiler and partitions caches by worker image", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pdf-pipeline-test-"));
  const actions = [];
  const observed = [];
  const image = `sha256:${"1".repeat(64)}`;
  const worker = async (_image, job, action) => {
    actions.push(action);
    if (action === "prepare")
      return Buffer.from(
        JSON.stringify({
          document: { schemaVersion: 1, blocks: [] },
          sources: ["https://example.com/plot.svg"],
        }),
      );
    assert.equal(action, "compile");
    const prepared = JSON.parse(
      await import("node:fs/promises").then((fs) =>
        fs.readFile(join(job, "prepared.json"), "utf8"),
      ),
    );
    assert.equal(prepared.assets[0].file, "image-0.input");
    return Buffer.concat([
      Buffer.from(
        JSON.stringify({
          ok: true,
          diagnostics: [],
          timings: {
            latexMs: 12,
            latexPasses: 2,
            hostPath: "private",
            invalid: -1,
          },
        }) + "\n",
      ),
      Buffer.from("%PDF-1.7\nfixture"),
    ]);
  };
  const options = {
    image,
    jobDirectory: directory,
    runWorker: worker,
    onTimings: (t) => observed.push(t),
    assetBase: "https://example.com",
    imageDependencies: {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      download: async () => ({
        bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
        mime: "image/svg+xml",
      }),
    },
  };
  const request = validateRequest({
    markdown: "---\ntitle: Test\nauthors:\n  - name: Ada\n---\n\nBody",
  });
  try {
    await compileJob(request, new AbortController().signal, options);
    assert.deepEqual(actions, ["prepare", "compile"]);
    assert.equal(observed[0].latexMs, 12);
    assert.equal(observed[0].hostPath, undefined);
    assert.equal(observed[0].invalid, undefined);
    await compileJob(request, new AbortController().signal, {
      ...options,
      image: `sha256:${"2".repeat(64)}`,
    });
    assert.deepEqual(actions, ["prepare", "compile", "prepare", "compile"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the cache partitions by worker image and reports hits without recompiling", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pdf-cache-test-"));
  const cache = join(directory, "cache");
  await mkdir(cache);
  const pdf = Buffer.from("%PDF-1.7\nfixture");
  let compiles = 0;
  const api = (image) => {
    const instance = createApi({
      ready: true,
      image,
      pdfCacheDirectory: cache,
      compile: async () => {
        compiles++;
        return { pdf, diagnostics: [] };
      },
    });
    instance.server.listen(0, "127.0.0.1");
    return instance;
  };
  const body = {
    markdown: "---\ntitle: Test\nauthors:\n  - name: Ada\n---\n\nBody",
  };
  const compile = (base) =>
    fetch(`${base}/pdf/compile`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  let first;
  let second;
  try {
    first = api(`sha256:${"1".repeat(64)}`);
    await once(first.server, "listening");
    const firstBase = `http://127.0.0.1:${first.server.address().port}`;
    assert.equal((await compile(firstBase)).status, 200);
    assert.equal(compiles, 1);
    const hit = await compile(firstBase);
    assert.equal((await hit.json()).diagnostics[0].code, "pdf-cache-hit");
    assert.equal(compiles, 1);
    first.shutdown();
    // A different worker image never reuses the first image's cache entries.
    second = api(`sha256:${"2".repeat(64)}`);
    await once(second.server, "listening");
    const secondBase = `http://127.0.0.1:${second.server.address().port}`;
    await compile(secondBase);
    assert.equal(compiles, 2);
  } finally {
    first?.shutdown();
    second?.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
});

test("native failure retries once in the legacy image and retains diagnostics", async () => {
  const nativeImage = `sha256:${"a".repeat(64)}`;
  const legacyImage = `sha256:${"b".repeat(64)}`;
  const calls = [];
  const logs = [];
  const write = console.log;
  console.log = (...args) => {
    logs.push(args.map(String).join(" "));
    write(...args);
  };
  let result;
  try {
    result = await compileJob(
      validateRequest({ markdown: "hello", engine: "rust" }, ["article"]),
      new AbortController().signal,
      {
        nativeImage,
        image: legacyImage,
        nativeTemplates: ["article"],
        runWorker: async (image, _directory, action) => {
          calls.push({ image, action });
          if (image === nativeImage)
            throw Object.assign(new Error("unsupported math"), {
              code: "compilation-failed",
              diagnostics: [
                {
                  code: "unsupported-math",
                  message: "Unknown command",
                  blockIndex: 2,
                },
              ],
            });
          if (action === "prepare")
            return Buffer.from(
              JSON.stringify({
                document: { schemaVersion: 1, blocks: [] },
                sources: [],
              }),
            );
          return Buffer.from(
            JSON.stringify({ ok: true, diagnostics: [] }) + "\n%PDF-test",
          );
        },
      },
    );
    assert.deepEqual(calls, [
      { image: nativeImage, action: "session" },
      { image: legacyImage, action: "prepare" },
      { image: legacyImage, action: "compile" },
    ]);
    assert.equal(result.diagnostics[0].blockIndex, 2);
    assert.equal(result.diagnostics[1].code, "native-engine-fallback");
    const jobs = logs.flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
    assert.equal(
      jobs.filter((job) => job.event === "pdf-job" && job.fallback === true)
        .length,
      1,
    );
  } finally {
    console.log = write;
  }
});
test("cancellation never starts a legacy retry", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    compileJob(
      validateRequest({ markdown: "hello", engine: "rust" }, ["article"]),
      controller.signal,
      {
        nativeImage: `sha256:${"a".repeat(64)}`,
        image: `sha256:${"b".repeat(64)}`,
        nativeTemplates: ["article"],
        runWorker: async () => {
          calls++;
          controller.abort();
          throw new Error("cancelled");
        },
      },
    ),
  );
  assert.equal(calls, 1);
});

test("a non-ServiceError from compile returns 422 JSON and CORS", async () => {
  const api = createApi({
    ready: true,
    compile: async () => {
      throw new Error("disk full");
    },
  });
  api.server.listen(0, "127.0.0.1");
  await once(api.server, "listening");
  const base = `http://127.0.0.1:${api.server.address().port}`;
  try {
    const response = await fetch(`${base}/pdf/compile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://publisle.xyz",
      },
      body: JSON.stringify({ markdown: "x" }),
    });
    assert.equal(response.status, 422);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^application\/json\b/u,
    );
    assert.equal(
      response.headers.get("access-control-allow-origin"),
      "https://publisle.xyz",
    );
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.code, "compilation-failed");
    assert.deepEqual(body.diagnostics, []);
    assert.match(body.message, /Could not compile this document/u);
  } finally {
    api.shutdown();
  }
});

test("native layout-overflow and invalid-table do not retry with LuaLaTeX", async () => {
  const nativeImage = `sha256:${"a".repeat(64)}`;
  const legacyImage = `sha256:${"b".repeat(64)}`;
  for (const code of ["layout-overflow", "invalid-table"]) {
    const calls = [];
    await assert.rejects(
      () =>
        compileJob(
          validateRequest({ markdown: "hello", engine: "rust" }, ["article"]),
          new AbortController().signal,
          {
            nativeImage,
            image: legacyImage,
            nativeTemplates: ["article"],
            runWorker: async (image, _directory, action) => {
              calls.push({ image, action });
              throw Object.assign(new Error(code), {
                code,
                diagnostics: [{ code, message: "too wide", blockIndex: 0 }],
              });
            },
          },
        ),
      (error) => {
        assert.equal(error.code, code);
        assert.equal(error.diagnostics[0].message, "too wide");
        return true;
      },
    );
    assert.deepEqual(calls, [{ image: nativeImage, action: "session" }]);
  }
});

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  parseJson,
  isPlainObject,
  type Block,
  type BlockType,
  type Document,
} from "@publisle/schema";
import {
  createNativePdfPackage,
  type NativeFont,
  type NativePdfOptions,
} from "./native.ts";
import { projectArticle, type ResearchLoss } from "./article.ts";

import { installedNativeCompiler } from "./native-install.ts";
const execute = promisify(execFile);
export interface NativeCompileOptions extends Omit<
  NativePdfOptions,
  "fonts" | "assets"
> {
  readonly sourceDirectory: string;
  readonly fonts?: readonly NativeFont[];
  readonly executable?: string;
  readonly fontManifest?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}
export interface NativeCompilerDiagnostic extends ResearchLoss {
  readonly blockId?: string;
  readonly blockIndex?: number;
}
export interface NativeCompileResult {
  readonly pdf: Uint8Array;
  readonly diagnostics: readonly NativeCompilerDiagnostic[];
  readonly timings: Readonly<Record<string, number>>;
  readonly pages: number;
  readonly compilerVersion: string;
}

/** Explicit native compiler invocation. Automatic selection remains gated on parity. */
export async function compileNativePdf(
  document: Document<Block<BlockType, unknown>>,
  options: NativeCompileOptions,
): Promise<NativeCompileResult> {
  const timeout = options.timeoutMs ?? 180_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0)
    throw new Error("Compilation timeout must be a positive integer.");
  const explicitExecutable =
    options.executable ?? process.env["PUBLISLE_NATIVE_COMPILER"];
  const explicitManifest =
    options.fontManifest ?? process.env["PUBLISLE_NATIVE_FONTS"];
  const installed =
    !explicitExecutable || (!options.fonts && !explicitManifest)
      ? await installedNativeCompiler()
      : undefined;
  const executable = explicitExecutable ?? installed?.executable;
  if (!executable) throw new Error("A pinned native PDF compiler is required.");
  let fonts = options.fonts;
  if (!fonts) {
    const manifest = explicitManifest ?? installed?.fontManifest;
    if (!manifest)
      throw new Error(
        "Set PUBLISLE_NATIVE_FONTS to the pinned font manifest JSON file.",
      );
    const bytes = await readFile(manifest);
    const raw = parseJson(bytes, {
      maxBytes: 65536,
      maxDepth: 8,
      maxNodes: 256,
    });
    if (!Array.isArray(raw))
      throw new Error("Native font manifest must be an array.");
    fonts = raw.map((entry: unknown) => {
      if (
        !isPlainObject(entry) ||
        typeof entry["path"] !== "string" ||
        ![
          "regular",
          "bold",
          "italic",
          "bold-italic",
          "mono",
          "fallback",
        ].includes(String(entry["role"])) ||
        (entry["index"] !== undefined &&
          (!Number.isSafeInteger(entry["index"]) || Number(entry["index"]) < 0))
      )
        throw new Error("Invalid native font manifest entry.");
      return {
        path: resolve(dirname(manifest), entry["path"]),
        role: entry["role"] as NativeFont["role"],
        ...(entry["index"] === undefined
          ? {}
          : { index: Number(entry["index"]) }),
      };
    });
  }
  const base = await realpath(options.sourceDirectory);
  const assets = await Promise.all(
    [
      ...new Set(
        projectArticle(document).blocks.flatMap((block) =>
          block.kind === "figure" ? [block.src] : [],
        ),
      ),
    ].map(async (source) => {
      if (/^[a-z][a-z0-9+.-]*:/iu.test(source))
        throw new Error("Native CLI figures must be validated local files.");
      const path = await realpath(resolve(base, source));
      const local = relative(base, path);
      if (isAbsolute(local) || local === ".." || local.startsWith(`..${sep}`))
        throw new Error(`Figure asset escapes manuscript directory: ${source}`);
      if ((await stat(path)).size > 16 * 1024 * 1024)
        throw new Error(`Figure asset exceeds 16 MiB: ${source}`);
      return { source, path };
    }),
  );
  const source = createNativePdfPackage(document, {
    ...options,
    fonts,
    assets,
  });
  const directory = await mkdtemp(join(tmpdir(), "publisle-native-"));
  try {
    const input = join(directory, "input.json");
    const output = join(directory, "manuscript.pdf");
    await writeFile(input, JSON.stringify(source.input), { flag: "wx" });
    let stdout: string;
    try {
      stdout = (
        await execute(executable, [input, output], {
          timeout,
          signal: options.signal,
          maxBuffer: 65536,
        })
      ).stdout;
    } catch (cause) {
      const stdout =
        cause && typeof cause === "object" && "stdout" in cause
          ? String(cause.stdout)
          : "";
      let message = "Native PDF compilation failed.";
      let diagnostics: NativeCompilerDiagnostic[] = [];
      try {
        const error = JSON.parse(stdout) as {
          diagnostics?: {
            code: string;
            message: string;
            blockIndex?: number;
          }[];
        };
        diagnostics = (error.diagnostics ?? [])
          .slice(0, 30)
          .filter(
            (entry) =>
              typeof entry.code === "string" &&
              typeof entry.message === "string",
          )
          .map((entry) => ({
            code: entry.code.slice(0, 100),
            message: entry.message.slice(0, 300),
            ...(typeof entry.blockIndex === "number" &&
            Number.isSafeInteger(entry.blockIndex) &&
            entry.blockIndex >= 0
              ? {
                  blockIndex: entry.blockIndex,
                  blockId: source.blockIds[entry.blockIndex],
                }
              : {}),
          }));
        const detail = diagnostics
          .map(
            (entry) =>
              `${entry.code}${entry.blockIndex === undefined ? "" : ` (${source.blockIds[entry.blockIndex] ?? "unknown block"})`}: ${entry.message}`,
          )
          .join("\n");
        if (detail) message = detail;
      } catch {
        /* Preserve the bounded process failure when no structured result exists. */
      }
      throw Object.assign(new Error(message, { cause }), { diagnostics });
    }
    const report = JSON.parse(stdout) as {
      ok?: boolean;
      compilerVersion?: string;
      pages?: number;
      diagnostics?: unknown;
      timings?: unknown;
    };
    if (
      report.ok !== true ||
      typeof report.pages !== "number" ||
      !Number.isSafeInteger(report.pages) ||
      report.pages < 1 ||
      report.pages > 300 ||
      typeof report.compilerVersion !== "string" ||
      report.compilerVersion.length === 0 ||
      report.compilerVersion.length > 64 ||
      (installed !== undefined &&
        report.compilerVersion !== installed.compilerVersion) ||
      (report.diagnostics !== undefined &&
        (!Array.isArray(report.diagnostics) ||
          report.diagnostics.length > 100 ||
          report.diagnostics.some(
            (entry) =>
              !isPlainObject(entry) ||
              typeof entry["code"] !== "string" ||
              typeof entry["message"] !== "string",
          ))) ||
      (report.timings !== undefined &&
        (!isPlainObject(report.timings) ||
          Object.values(report.timings).some(
            (value) =>
              typeof value !== "number" || !Number.isFinite(value) || value < 0,
          )))
    )
      throw new Error("Invalid native compiler report.");
    const outputInfo = await stat(output);
    if (outputInfo.size > 16 * 1024 * 1024)
      throw new Error("Native PDF exceeds 16 MiB.");
    const pdf = new Uint8Array(await readFile(output));
    if (new TextDecoder().decode(pdf.subarray(0, 5)) !== "%PDF-")
      throw new Error("Native compiler returned an invalid PDF.");
    const expectedHeader =
      source.input.pdfStandard === "ua-1"
        ? "%PDF-1.7"
        : source.input.pdfStandard === "ua-2"
          ? "%PDF-2.0"
          : undefined;
    if (
      expectedHeader &&
      new TextDecoder().decode(pdf.subarray(0, 8)) !== expectedHeader
    )
      throw new Error(
        "Native compiler returned the wrong PDF version for the requested standard.",
      );
    return {
      pdf,
      diagnostics: [
        ...source.diagnostics,
        ...((report.diagnostics ?? []) as ResearchLoss[]),
      ],
      timings: (report.timings ?? {}) as Record<string, number>,
      pages: report.pages,
      compilerVersion: report.compilerVersion,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

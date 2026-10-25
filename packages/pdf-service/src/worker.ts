import { readFile, writeFile, mkdir, copyFile, access } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { join } from "node:path";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  parseDocument,
  parseJson,
  createBlock,
  type Document,
} from "@publisle/schema";
import { fromMarkdown } from "@publisle/markdown";
import { prepare, createRegistry } from "@publisle/core";
import { coreBlockDefinitions } from "@publisle/blocks-core";
import { interactiveSchematicDefinition } from "@publisle/blocks-technical";
import {
  createLatexPackage,
  createNativePdfPackage,
  type NativeFont,
  type NativePdfTemplate,
} from "@publisle/research";
import { compileNativePdf, checkSvg } from "@publisle/research/node";
import { template as ieee } from "@publisle/template-ieee";
import { template as acm } from "@publisle/template-acm";
import { template as springer } from "@publisle/template-springer";
import {
  template as elsevier,
  authorDateTemplate,
} from "@publisle/template-elsevier";

const templates = {
  "ieee-journal": ieee,
  "acm-journal": acm,
  "springer-journal": springer,
  "elsevier-numeric": elsevier,
  "elsevier-author-date": authorDateTemplate,
};
const execute = promisify(execFile);
async function nativeFonts(): Promise<readonly NativeFont[]> {
  return JSON.parse(
    await readFile("/app/native-fonts.json", "utf8"),
  ) as NativeFont[];
}
interface Job {
  document?: unknown;
  markdown?: string;
  template: string;
  engine: "pdflatex" | "lualatex" | "rust";
  style: string;
  data: { country?: string };
}
interface Asset {
  source: string;
  file: string;
  mime: string;
}

// Research currently renders inline image alt text. Lower them to adjacent
// figure blocks so Markdown images are embedded without losing that text.
export function lowerImages(document: Document): {
  document: Document;
  sources: string[];
} {
  const sources = new Set<string>();
  const result = structuredClone(document);
  const blocks: Document["blocks"][number][] = [];
  for (const block of result.blocks) {
    const figures: Document["blocks"][number][] = [];
    const visit = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      const item = value as Record<string, unknown>;
      if (item["type"] === "inlineImage" && typeof item["url"] === "string") {
        const src = item["url"];
        const alt = typeof item["alt"] === "string" ? item["alt"] : "";
        sources.add(src);
        figures.push(
          createBlock({
            type: "publisle:figure",
            data: { src, alt, caption: [] },
          }),
        );
        for (const key of Object.keys(item)) Reflect.deleteProperty(item, key);
        Object.assign(item, { type: "text", value: alt });
      } else Object.values(item).forEach(visit);
    };
    if (
      block.type === "publisle:figure" &&
      block.data &&
      typeof block.data === "object"
    ) {
      const src = (block.data as Record<string, unknown>)["src"];
      if (typeof src === "string") sources.add(src);
    }
    visit(block.data);
    blocks.push(block, ...figures);
  }
  return { document: { ...result, blocks }, sources: [...sources] };
}

function replaceFigures(
  document: Document,
  paths: Map<string, string>,
): Document {
  return {
    ...document,
    blocks: document.blocks.map((block) => {
      if (block.type !== "publisle:figure") return block;
      const data = block.data as Record<string, unknown>;
      const path = paths.get(String(data["src"]));
      if (!path) throw new Error("A figure image could not be resolved.");
      return { ...block, data: { ...data, src: path } };
    }),
  };
}

export async function convertAssets(
  assets: Asset[],
  inputDirectory: string,
  preserveSvg = false,
) {
  const { default: sharp } = await import("sharp");
  sharp.cache(false);
  // Each conversion runs with single-threaded libvips; conversions themselves
  // run in parallel below, so worker threads stay busy without
  // oversubscribing the CPU budget.
  sharp.concurrency(1);
  // Convert in parallel, then emit in the authored asset order: the output
  // protocol is NDJSON record + bytes pairs consumed sequentially.
  const converted = await Promise.all(
    assets.map(async (asset, index) => {
      if (!/^image-[0-9]+\.input$/u.test(asset.file))
        throw new Error("Invalid asset name.");
      const bytes = await readFile(join(inputDirectory, asset.file));
      if (asset.mime === "image/svg+xml") {
        checkSvg(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        if (preserveSvg) {
          if (bytes.length > 4 * 1024 * 1024)
            throw new Error("SVG exceeds 4 MiB.");
          // Native fonts must resolve SVG text. Rasterizing here would use
          // librsvg's unrelated system font database and lose selectable text.
          return {
            source: asset.source,
            file: `image-${String(index)}.svg`,
            bytes,
          };
        }
      }
      const image = sharp(bytes, {
        limitInputPixels: 8_000_000,
        failOn: "warning",
        animated: false,
      });
      const metadata = await image.metadata();
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > 8_000_000 ||
        !["png", "jpeg", "svg"].includes(metadata.format) ||
        (metadata.pages ?? 1) > 1 ||
        (metadata.format === "svg" && asset.mime !== "image/svg+xml")
      )
        throw new Error("Invalid or oversized image.");
      return {
        source: asset.source,
        file: `image-${String(index)}.${metadata.format === "jpeg" ? "jpg" : metadata.format === "svg" ? "png" : metadata.format}`,
        bytes: metadata.format === "svg" ? await image.png().toBuffer() : bytes,
      };
    }),
  );
  return converted;
}

async function main(): Promise<void> {
  const started = performance.now();
  const timings: Record<string, number> = {};
  const action = process.argv[2];
  const inputDirectory = process.env["PDF_INPUT"] ?? "/input";
  const raw = parseJson(await readFile(join(inputDirectory, "request.json")), {
    maxBytes: 262144,
    maxDepth: 64,
    maxNodes: 20000,
  });
  const job = raw as unknown as Job;
  if (action === "prepare" || action === "session") {
    if (action === "session" && job.engine !== "rust")
      throw new Error("Sessions require the native engine.");
    const imported =
      job.markdown === undefined
        ? { document: parseDocument(job.document), diagnostics: [] }
        : fromMarkdown(job.markdown);
    if (
      !imported.document ||
      imported.diagnostics.some((entry) => entry.level === "error")
    )
      throw new Error("The editor source is invalid.");
    const prepared = prepare(imported.document, {
      registry: createRegistry([
        ...coreBlockDefinitions,
        interactiveSchematicDefinition,
      ]),
    });
    if (
      !prepared.document ||
      prepared.diagnostics.some((entry) => entry.level === "error")
    )
      throw new Error("The document failed validation.");
    const lowered = lowerImages(parseDocument(prepared.document));
    // Validate template requirements before spending network or compiler time.
    const fake = new Map(
      lowered.sources.map((source, index) => [
        source,
        `image-${String(index)}.png`,
      ]),
    );
    if (job.engine === "rust") {
      createNativePdfPackage(replaceFigures(lowered.document, fake), {
        template: job.template as NativePdfTemplate,
        style: job.style,
        fonts: await nativeFonts(),
        data: job.data,
      });
    } else
      createLatexPackage(replaceFigures(lowered.document, fake), {
        ...job,
        engine: job.engine,
        templates,
      });
    if (lowered.sources.length > 12)
      throw new Error("At most 12 distinct images are supported.");
    process.stdout.write(
      JSON.stringify({
        document: lowered.document,
        sources: lowered.sources,
        timings: { prepareMs: performance.now() - started },
      }) + (action === "session" ? "\n" : ""),
    );
    if (action === "prepare") return;
    for (;;) {
      try {
        await access(join(inputDirectory, "ready"));
        break;
      } catch {
        if (performance.now() - started > 170000)
          throw new Error("Asset acquisition timed out.");
        await delay(20);
      }
    }
  }
  if (action !== "compile" && action !== "images" && action !== "session")
    throw new Error("Unknown worker operation.");
  const normalized = JSON.parse(
    await readFile(join(inputDirectory, "prepared.json"), "utf8"),
  ) as { document: Document; assets: Asset[] };
  if (action === "images") {
    const converted = await convertAssets(
      normalized.assets,
      inputDirectory,
      job.engine === "rust",
    );
    let total = 0;
    for (const item of converted) {
      total += item.bytes.length;
      if (total > 16 * 1024 * 1024)
        throw new Error("Converted images exceed the size limit.");
      const record = JSON.stringify({
        source: item.source,
        file: item.file,
        bytes: item.bytes.length,
      });
      if (!process.stdout.write(record + "\n"))
        await once(process.stdout, "drain");
      if (!process.stdout.write(item.bytes))
        await once(process.stdout, "drain");
    }
    return;
  }
  const buildDirectory = "/tmp/build";
  await mkdir(buildDirectory);
  const paths = new Map<string, string>();
  const imagesStarted = performance.now();
  if (normalized.assets.some((asset) => asset.file.endsWith(".input"))) {
    const converted = await convertAssets(
      normalized.assets,
      inputDirectory,
      job.engine === "rust",
    );
    let total = 0;
    for (const asset of converted) {
      total += asset.bytes.length;
      if (total > 16 * 1024 * 1024)
        throw new Error("Converted images exceed the size limit.");
      await writeFile(join(buildDirectory, asset.file), asset.bytes, {
        flag: "wx",
      });
      paths.set(asset.source, asset.file);
    }
  } else {
    for (const asset of normalized.assets) {
      if (
        !/^image-[0-9]+\.(png|jpg|svg)$/u.test(asset.file) ||
        (asset.file.endsWith(".svg") && job.engine !== "rust")
      )
        throw new Error("Invalid converted asset name.");
      await copyFile(
        join(inputDirectory, asset.file),
        join(buildDirectory, asset.file),
      );
      paths.set(asset.source, asset.file);
    }
  }
  timings["imagesMs"] = performance.now() - imagesStarted;
  const sourceStarted = performance.now();
  const document = replaceFigures(normalized.document, paths);
  if (job.engine === "rust") {
    const native = await compileNativePdf(document, {
      template: job.template as NativePdfTemplate,
      style: job.style,
      sourceDirectory: buildDirectory,
      fonts: await nativeFonts(),
      executable: "/usr/local/bin/publisle-pdf",
      timeoutMs: 170000,
      data: job.data,
    });
    Object.assign(timings, native.timings, {
      workerMs: performance.now() - started,
    });
    const diagnostics = native.diagnostics
      .slice(0, 30)
      .map(({ code, message, blockIndex }) => ({
        code,
        message: message.slice(0, 200),
        ...(blockIndex === undefined ? {} : { blockIndex }),
      }));
    if (
      !process.stdout.write(
        JSON.stringify({ ok: true, diagnostics, timings }) + "\n",
      )
    )
      await once(process.stdout, "drain");
    process.stdout.write(native.pdf);
    return;
  }
  const source = createLatexPackage(document, {
    ...job,
    engine: job.engine,
    templates,
  });
  timings["sourceMs"] = performance.now() - sourceStarted;
  const cacheDirectory = join(buildDirectory, "cache");
  await mkdir(cacheDirectory);
  const safePath = (name: string): string => {
    if (
      !/^[A-Za-z0-9_./-]+$/u.test(name) ||
      name.startsWith("/") ||
      name.split("/").includes("..")
    )
      throw new Error("Invalid compiler resource path.");
    return join(buildDirectory, name);
  };
  for (const [name, bytes] of Object.entries({
    ...source.files,
    ...source.resources,
  })) {
    const path = safePath(name);
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, bytes, { flag: "wx" });
  }
  for (const asset of source.assets) {
    if (!/^image-[0-9]+\.(png|jpg)$/u.test(asset.source))
      throw new Error("Invalid image resource path.");
    const path = safePath(asset.destination);
    await mkdir(join(path, ".."), { recursive: true });
    if (path !== join(buildDirectory, asset.source))
      await copyFile(join(buildDirectory, asset.source), path);
  }
  // The immutable image has already passed compiler preflight. Run only the
  // dependency-driven compilation and PDF checks; avoid CLI startup, repeated
  // font probes, source archives and per-request dependency manifests.
  const latexStarted = performance.now();
  const { stdout: compilerOutput } = await execute(
    "latexmk",
    [
      source.engine === "pdflatex" ? "-pdf" : "-lualatex",
      "-norc",
      "-interaction=nonstopmode",
      "-halt-on-error",
      "-file-line-error",
      "-no-shell-escape",
      "manuscript.tex",
    ],
    {
      cwd: buildDirectory,
      timeout: 170000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        TEXMFOUTPUT: buildDirectory,
        TEXMFVAR: cacheDirectory,
        TEXMFCACHE: `${cacheDirectory}:/opt/texlive/texmf-var`,
        openin_any: "r",
        openout_any: "p",
      },
    },
  );
  timings["latexMs"] = performance.now() - latexStarted;
  timings["latexPasses"] = [
    ...compilerOutput.matchAll(
      /Run number [0-9]+ of rule '(?:lualatex|pdflatex)'/gu,
    ),
  ].length;
  timings["workerMs"] = performance.now() - started;
  const log = await readFile(join(buildDirectory, "manuscript.log"), "utf8");
  if (
    /Missing character:|undefined references|Citation .* undefined|Reference .* undefined/iu.test(
      log,
    )
  )
    throw new Error("Unresolved references or missing glyphs.");
  const pdf = await readFile(join(buildDirectory, "manuscript.pdf"));
  if (pdf.length > 16 * 1024 * 1024)
    throw new Error("The PDF exceeds its size limit.");
  const diagnostics = [
    ...source.diagnostics,
    ...log
      .split("\n")
      .filter((line) => /Overfull \\[hv]box/u.test(line))
      .map((message) => ({ code: "latex-layout-overflow", message })),
  ]
    .slice(0, 30)
    .map(({ code, message }) => ({ code, message: message.slice(0, 200) }));
  if (
    !process.stdout.write(
      JSON.stringify({ ok: true, diagnostics, timings }) + "\n",
    )
  )
    await once(process.stdout, "drain");
  process.stdout.write(pdf);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main().catch(async (error: unknown) => {
    if (process.env["PDF_DEBUG"] === "true")
      process.stderr.write(
        String(error instanceof Error ? error.stack : error) +
          "\n" +
          ((error as { stdout?: string }).stdout ?? "").slice(-4000),
      );
    const memoryEvents = await readFile(
      "/sys/fs/cgroup/memory.events",
      "utf8",
    ).catch(() => "");
    const outOfMemory = /^oom_kill [1-9][0-9]*$/mu.test(memoryEvents);
    const preparing = process.argv[2] === "prepare";
    // Compilation logs may include host paths or TeX internals; never return them.
    const message =
      preparing && error instanceof Error
        ? error.message.slice(0, 300)
        : "PDF compilation failed. Check figures, math, citations, and document size.";
    process.stdout.write(
      JSON.stringify({
        ok: false,
        code: outOfMemory
          ? "resource-limit"
          : preparing
            ? "invalid-document"
            : "compilation-failed",
        diagnostics: (error as { diagnostics?: unknown }).diagnostics,
        message: outOfMemory
          ? "This document exceeds the PDF service memory budget."
          : message,
      }) + "\n",
    );
    process.exitCode = 1;
  });
}

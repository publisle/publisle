// Runs inside budget-check's isolated host-sized runtime.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { createHash } from "node:crypto";
import { cpus, release } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { playgroundExamples } from "../../sites/www/src/lib/playground-examples.ts";
import { activeBudget } from "./budget.mjs";
import { validateRequest, TEMPLATES } from "./limits.mjs";
const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const rust = process.env.PDF_BENCH_RUST === "true";
const nativeTemplates = rust ? TEMPLATES.map((template) => template.id) : [];
const { compileJob: latexCompile } = await import(
  pathToFileURL(
    process.env.PDF_BENCH_SERVER ?? join(root, "deploy/vps/server.mjs"),
  )
);
const compileJob =
  process.env.PDF_BENCH_NATIVE === "true"
    ? (await import("./native-study.mjs")).compileNative
    : latexCompile;
function recordedBudget() {
  const cpu = Number(process.env.PDF_AGGREGATE_CPU);
  const memoryMiB = Number(process.env.PDF_AGGREGATE_MEMORY_MIB);
  if (cpu >= 1 && memoryMiB >= 1) return { cpu, memoryMiB };
  const budget = activeBudget();
  return { cpu: budget.aggregateCpu, memoryMiB: budget.aggregateMemoryMiB };
}
const output = resolve(process.env.PDF_QA_ARTIFACTS ?? ".local/pdf-benchmark");
await mkdir(output, { recursive: true });
const image = (
  await execute("docker", [
    "image",
    "inspect",
    process.env.PDF_QA_IMAGE ?? "publisle-pdf-worker:local",
    "--format",
    "{{.Id}}",
  ])
).stdout.trim();
const group = (
  await execute("systemctl", [
    "--user",
    "show",
    "publislepdfqa.slice",
    "-p",
    "ControlGroup",
    "--value",
  ])
).stdout.trim();
const cgroup = `/sys/fs/cgroup${group}`;
const samples = Number(process.env.PDF_BENCH_SAMPLES ?? 30);
const warmups = Number(process.env.PDF_BENCH_WARMUPS ?? 5);
const selected = (
  process.env.PDF_BENCH_CASES ?? "starter,research,fourier,arabic"
).split(",");
const corpus = {
  starter: {
    markdown:
      "---\ntitle: Hello, Publisle\nauthors:\n  - name: Ada Example\n---\n\n# Hello\n\nA short article with $e^{i\\pi}+1=0$.\n",
  },
  research: {
    markdown: playgroundExamples.find((x) => x.id === "research-paper")
      .markdown,
  },
  fourier: {
    markdown: playgroundExamples.find((x) => x.id === "fft").markdown,
  },
  arabic: {
    // Hosted figures accept raster/SVG inputs, rather than embedded PDFs.
    markdown: (
      await readFile(join(root, "examples/articles/article-arabic.md"), "utf8")
    ).replaceAll("ieee-square-wave.pdf", "fourier-square-wave.svg"),
    template: "article-arabic",
  },
};
const assets = {
  resolve: async () => [{ address: "93.184.216.34", family: 4 }],
  download: async ({ url }) => {
    const name = basename(url.pathname);
    let bytes;
    for (const directory of ["sites/www/public", "examples/articles"])
      try {
        bytes = await readFile(join(root, directory, name));
        break;
      } catch {
        /* next fixture directory */
      }
    if (!bytes) throw new Error(`Missing benchmark asset: ${name}`);
    return {
      bytes,
      mime: name.endsWith(".svg")
        ? "image/svg+xml"
        : name.endsWith(".jpg")
          ? "image/jpeg"
          : "image/png",
    };
  },
};
const report = {
  backend: rust
    ? "Publisle custom Rust engine"
    : process.env.PDF_BENCH_NATIVE === "true"
      ? "Typst feasibility via Pandoc"
      : "LaTeX",
  schemaVersion: 1,
  environment: { cpu: cpus()[0]?.model, kernel: release() },
  nativeBinaries:
    process.env.PDF_BENCH_NATIVE === "true"
      ? await Promise.all(
          ["pandoc", "typst"].map(async (name) => ({
            name,
            sha256: createHash("sha256")
              .update(await readFile(join(root, ".local/benchmark-bin", name)))
              .digest("hex"),
          })),
        )
      : undefined,
  complete: false,
  image,
  node: process.version,
  cpu: recordedBudget().cpu,
  memoryMiB: recordedBudget().memoryMiB,
  warmups,
  samples,
  assets:
    "local fixture bytes via the normal validated download path; no network variability",
  results: [],
};
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[
    Math.max(0, Math.ceil(values.length * p) - 1)
  ];
for (const name of selected) {
  const request = validateRequest(
    { ...corpus[name], ...(rust ? { engine: "rust" } : {}) },
    nativeTemplates,
  );
  const row = {
    name,
    sourceSha256: createHash("sha256").update(request.markdown).digest("hex"),
    observations: [],
  };
  report.results.push(row);
  for (let i = -warmups; i < samples; i++) {
    const eventsBefore = await readFile(`${cgroup}/cpu.stat`, "utf8");
    const start = performance.now();
    const timings = {};
    let result;
    try {
      result = await compileJob(request, new AbortController().signal, {
        image,
        ...(rust ? { nativeImage: image, nativeTemplates } : {}),
        assetBase: "https://fixture.invalid/",
        imageDependencies: assets,
        studyDirectory:
          process.env.PDF_BENCH_NATIVE === "true"
            ? join(output, `${name}-source`)
            : undefined,
        onTimings: (value) => Object.assign(timings, value),
      });
    } catch (error) {
      row.failure = {
        code: error.code ?? "unsupported-fixture",
        message: String(error.message)
          .split("\n")[0]
          .replaceAll(root, "<repo>"),
      };
      console.log(JSON.stringify({ fixture: name, failure: row.failure }));
      break;
    }
    const elapsedMs = performance.now() - start;
    const file = join(output, `${name}.pdf`);
    await writeFile(file, result.pdf);
    const text = (await execute("pdftotext", [file, "-"])).stdout;
    if (text.trim().length < 20) throw new Error("Empty PDF text");
    if (i >= 0)
      row.observations.push({
        elapsedMs,
        bytes: result.pdf.length,
        timings,
        cpuBefore: eventsBefore,
        cpuAfter: await readFile(`${cgroup}/cpu.stat`, "utf8"),
        peakMemoryBytes: Number(
          await readFile(`${cgroup}/memory.peak`, "utf8"),
        ),
      });
    await writeFile(
      join(output, "results.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        fixture: name,
        sample: i,
        elapsedMs: Math.round(elapsedMs),
        timings,
      }),
    );
  }
  if (row.failure) continue;
  row.medianMs = percentile(
    row.observations.map((x) => x.elapsedMs),
    0.5,
  );
  row.p95Ms = percentile(
    row.observations.map((x) => x.elapsedMs),
    0.95,
  );
}
report.passed = report.results.every(
  (row) => !row.failure && (!rust || row.p95Ms < 5000),
);
report.complete = true;
report.memoryEvents = await readFile(`${cgroup}/memory.events`, "utf8");
await writeFile(join(output, "results.json"), JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;

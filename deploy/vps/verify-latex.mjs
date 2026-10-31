/**
 * Uncached LaTeX worker gate, executed within the production aggregate budget.
 *
 * It runs as its own small process, started with the API's Node flags, after the
 * native gate has exited. Production has no 200 MiB validation harness inside the
 * 512 MiB slice, so neither may this gate: a LaTeX container shares the slice only
 * with the API and the rootless Docker daemon.
 *
 * The API enables PDF_WORKER_IMAGE only when a report names that exact image ID
 * and has one successful sample per template (server.mjs checkReadiness). One
 * compile per template, with the engine the API uses by default, is the gate; the
 * 30-sample latency gate applies to the native path only.
 *
 * Non-default engines are deliberately not gated. LuaLaTeX on ieee-journal sits at
 * the edge of the 512 MiB slice with the previously live image as well and passes
 * or fails from run to run, so gating it would make every deployment flaky. Such a
 * request fails with a clear resource-limit error instead of a release failure.
 */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compileJob } from "./server.mjs";
import { TEMPLATES, validateRequest } from "./limits.mjs";
const exec = promisify(execFile),
  root = join(import.meta.dirname, "../..");
const [latexImage, stage] = process.argv.slice(2);
assert(/^sha256:[a-f0-9]{64}$/.test(latexImage ?? ""));
assert(stage);
const own = (await readFile("/proc/self/cgroup", "utf8")).trim().split("::")[1];
const suffix = "/publisle-pdf.slice";
assert(own.includes(suffix + "/"));
const group =
  "/sys/fs/cgroup" + own.slice(0, own.indexOf(suffix) + suffix.length);
const cpu = (await readFile(group + "/cpu.max", "utf8"))
  .trim()
  .split(" ")
  .map(Number);
assert.equal(cpu[0] / cpu[1], 0.5);
assert.equal(
  Number(await readFile(group + "/memory.max", "utf8")),
  512 * 1024 * 1024,
);
assert.equal(Number(await readFile(group + "/memory.swap.max", "utf8")), 0);
await mkdir(join(stage, "results"), { recursive: true });
await mkdir(join(stage, "jobs"), { recursive: true });
const before = await readFile(group + "/memory.events", "utf8");
const latexReport = {
  image: latexImage,
  passed: false,
  aggregateCpu: 0.5,
  aggregateMemoryMiB: 512,
  swapMiB: 0,
  samples: [],
};
const png = await readFile(
  join(root, "examples/articles/paper-convergence.png"),
);
const latexAssets = {
  resolve: async () => [{ address: "93.184.216.34", family: 4 }],
  download: async () => ({ bytes: png, mime: "image/png" }),
};
for (const template of TEMPLATES) {
  const arabic = template.id === "article-arabic";
  const markdown =
    (
      await readFile(
        join(
          root,
          "examples/articles",
          arabic ? "article-arabic.md" : "ieee-journal.md",
        ),
        "utf8",
      )
    ).replaceAll(
      'src="ieee-square-wave.pdf"',
      'src="https://fixture.invalid/plot.png"',
    ) + (arabic ? "\n\nالعَرَبِيَّة لا للاختبار.\n" : "");
  const engine = template.engines[0];
  const started = performance.now();
  const result = await compileJob(
    validateRequest({
      markdown,
      template: template.id,
      engine,
      data: { country: "Jordan" },
    }),
    new AbortController().signal,
    {
      image: latexImage,
      imageDependencies: latexAssets,
      assetBase: "https://fixture.invalid/",
      jobDirectory: join(stage, "jobs"),
    },
  );
  const file = join(stage, "results", `${template.id}-${engine}.pdf`);
  await writeFile(file, result.pdf);
  const text = (await exec("pdftotext", [file, "-"])).stdout;
  assert(text.includes("1949"), `${template.id}/${engine} lost its references`);
  assert(!/\ufffd/u.test(text), `${template.id}/${engine} has missing glyphs`);
  latexReport.samples.push({
    template: template.id,
    engine,
    pdfBytes: result.pdf.length,
  });
  console.log(
    JSON.stringify({
      latexTemplate: template.id,
      engine,
      elapsedMs: Math.round(performance.now() - started),
    }),
  );
}
const after = await readFile(group + "/memory.events", "utf8");
const counter = (text) => Number(text.match(/^oom_kill (\d+)$/mu)?.[1] ?? 0);
assert.equal(
  counter(after),
  counter(before),
  "OOM during LaTeX deployment validation",
);
latexReport.passed = true;
await writeFile(
  join(stage, "verification-latex.json"),
  JSON.stringify(latexReport, null, 2),
);

/** Uncached deployment gate, executed within the production aggregate budget. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { compileJob } from "./server.mjs";
import { TEMPLATES, validateRequest, availableTemplates } from "./limits.mjs";
import { assertCompliant } from "../../tools/validate-pdf-ua.mjs";
const exec = promisify(execFile),
  root = join(import.meta.dirname, "../..");
const [image, stage] = process.argv.slice(2);
assert(/^sha256:[a-f0-9]{64}$/.test(image ?? ""));
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
const ids = TEMPLATES.map((t) => t.id),
  before = await readFile(group + "/memory.events", "utf8");
const report = {
  image,
  passed: false,
  aggregateCpu: 0.5,
  aggregateMemoryMiB: 512,
  swapMiB: 0,
  samples: [],
  native: { templates: [] },
  results: [],
};
const assets = {
  resolve: async () => [{ address: "93.184.216.34", family: 4 }],
  download: async ({ url }) => {
    assert.equal(basename(url.pathname), "fft-spectrum.svg");
    return {
      bytes: await readFile(join(root, "sites/www/public/fft-spectrum.svg")),
      mime: "image/svg+xml",
    };
  },
};
for (const template of ids) {
  let markdown = (
    await readFile(
      join(
        root,
        "examples/articles",
        template === "article-arabic" ? "article-arabic.md" : "ieee-journal.md",
      ),
      "utf8",
    )
  ).replaceAll(
    "ieee-square-wave.pdf",
    "https://fixture.invalid/fft-spectrum.svg",
  );
  if (template === "article-arabic")
    markdown += "\n\nالعَرَبِيَّة لا للاختبار.\n";
  assert.notEqual(
    availableTemplates(ids).find((t) => t.id === template).engines[0],
    "rust",
  );
  const request = validateRequest(
      { markdown, template, engine: "rust", data: { country: "Jordan" } },
      ids,
    ),
    observations = [];
  for (let n = -5; n < 30; n++) {
    const start = performance.now();
    const result = await compileJob(request, new AbortController().signal, {
      image,
      nativeImage: image,
      nativeTemplates: ids,
      imageDependencies: assets,
      assetBase: "https://fixture.invalid/",
      jobDirectory: join(stage, "jobs"),
    });
    const elapsed = performance.now() - start;
    if (n >= 0) observations.push(elapsed);
    if (n === 0) {
      const file = join(stage, "results", template + ".pdf");
      await writeFile(file, result.pdf);
      const text = (await exec("pdftotext", [file, "-"])).stdout
        .normalize("NFKC")
        .replace(/[\u202a-\u202e\u2066-\u2069]/gu, "");
      assert(!/[\u25a1\ufffd]/u.test(text));
      assert(text.includes("1949"));
      assert(
        text.includes(
          template === "article-arabic" ? "اختبار النشر العلمي" : "Fourier",
        ),
      );
      if (template === "article-arabic")
        assert(text.includes("العَرَبِيَّة لا للاختبار.".normalize("NFKC")));
      const xml = (await exec("pdftotext", ["-bbox", file, "-"])).stdout;
      let dimensions;
      for (const match of xml.matchAll(
        /<page width="([\d.]+)" height="([\d.]+)"|<word xMin="([\d.-]+)" yMin="([\d.-]+)" xMax="([\d.-]+)" yMax="([\d.-]+)"/gu,
      )) {
        if (match[1]) dimensions = [Number(match[1]), Number(match[2])];
        else {
          assert(dimensions);
          const box = match.slice(3).map(Number);
          assert(
            box.every(Number.isFinite) &&
              box[0] >= 0 &&
              box[1] >= 0 &&
              box[2] <= dimensions[0] &&
              box[3] <= dimensions[1],
            template + " has off-page text",
          );
        }
      }
      const validation = (
        await exec(
          join(stage, "verapdf/verapdf"),
          ["--flavour", "ua2", "--format", "xml", file],
          { maxBuffer: 8 * 1024 * 1024 },
        )
      ).stdout;
      assertCompliant(validation, "ua2");
      await writeFile(
        join(stage, "results", template + ".validation.xml"),
        validation,
      );
      await exec("pdftoppm", [
        "-scale-to",
        "900",
        "-png",
        file,
        join(stage, "results", template),
      ]);
      report.samples.push({
        template,
        engine: "rust",
        pdfBytes: result.pdf.length,
      });
    }
    if (n % 5 === 0)
      console.log(
        JSON.stringify({ template, sample: n, elapsedMs: Math.round(elapsed) }),
      );
  }
  const sorted = [...observations].sort((a, b) => a - b),
    p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  assert(p95 < 5000, `${template}: p95 ${p95}ms`);
  report.results.push({
    template,
    warmups: 5,
    observations,
    uncachedSamples: 30,
    uncachedP95Ms: p95,
  });
  report.native.templates.push({
    id: template,
    contentParity: true,
    layoutChecksPassed: true,
    pdfUa2: true,
    uncachedSamples: 30,
    uncachedP95Ms: p95,
  });
  await writeFile(
    join(stage, "progress.json"),
    JSON.stringify(report, null, 2),
  );
}
const after = await readFile(group + "/memory.events", "utf8");
const counter = (text) => Number(text.match(/^oom_kill (\d+)$/mu)?.[1] ?? 0);
assert.equal(
  counter(after),
  counter(before),
  "OOM during deployment validation",
);
report.passed = true;
await writeFile(
  join(stage, "verification.json"),
  JSON.stringify(report, null, 2),
);

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  writeFile,
  mkdtemp,
  rm,
  readdir,
  mkdir,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { compileJob } from "../server.mjs";
import { validateRequest, TEMPLATES } from "../limits.mjs";

import { assertCompliant } from "../../../tools/validate-pdf-ua.mjs";
const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");
test(
  "all advertised engines compile research papers with PDF images and readable fallback",
  { skip: !process.env.PDF_TEST_WORKER_IMAGE, timeout: 600000 },
  async () => {
    const artifacts =
      process.env.PDF_TEST_ARTIFACTS ??
      (await mkdtemp(join(tmpdir(), "pdf-compiler-test-")));
    await mkdir(artifacts, { recursive: true });
    const jobDirectory = await mkdtemp(join(tmpdir(), "pdf-test-jobs-"));
    const png = await readFile(
      join(root, "examples/articles/paper-convergence.png"),
    );
    const svg = await readFile(join(root, "sites/www/public/favicon.svg"));
    const require = createRequire(
      join(root, "packages/pdf-service/package.json"),
    );
    const jpeg = await require("sharp")(png).resize(32, 32).jpeg().toBuffer();
    const images = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      download: async ({ url }) => ({
        bytes: url.pathname.endsWith("svg")
          ? svg
          : url.pathname.endsWith("jpg")
            ? jpeg
            : png,
        mime: url.pathname.endsWith("svg")
          ? "image/svg+xml"
          : url.pathname.endsWith("jpg")
            ? "image/jpeg"
            : "image/png",
      }),
    };
    try {
      for (const template of TEMPLATES) {
        for (const engine of template.engines) {
          let markdown = await readFile(
            join(
              root,
              "examples/articles",
              template.id === "article-arabic"
                ? "article-arabic.md"
                : "ieee-journal.md",
            ),
            "utf8",
          );
          markdown = markdown.replaceAll(
            'src="ieee-square-wave.pdf"',
            'src="https://fixture.invalid/plot.png"',
          );
          markdown +=
            "\n\n![JPEG photograph](https://fixture.invalid/photo.jpg)\n";
          markdown +=
            '\n\n![Inline brand image](https://fixture.invalid/brand.svg)\n\n::::interactive{type="publisle:interactive-schematic" schemaVersion="2" activation="visible"}\n:::fallback\nThe experiment remains readable in PDF.\n:::\n\n```publisle-payload\n{"source":"./counter.json"}\n```\n::::\n';
          const result = await compileJob(
            validateRequest({
              markdown,
              template: template.id,
              engine,
              data: { country: "Jordan" },
            }),
            new AbortController().signal,
            {
              image: process.env.PDF_TEST_WORKER_IMAGE,
              assetBase: "https://fixture.invalid/",
              imageDependencies: images,
              jobDirectory,
            },
          );
          assert.deepEqual(
            await readdir(jobDirectory),
            [],
            "Job files must be removed after compilation",
          );
          const path = join(artifacts, `${template.id}-${engine}.pdf`);
          await writeFile(path, result.pdf);
          const text = (await execute("pdftotext", [path, "-"])).stdout;
          assert.ok(text.includes("1949"), "Bibliography must survive export");
          assert.ok(
            text.includes("experiment remains readable"),
            "Interactive fallback must survive export",
          );
          const objects = (await execute("pdfimages", ["-list", path])).stdout;
          assert.ok(
            objects.split("\n").filter((line) => /\bimage\b/.test(line))
              .length >= 3,
            objects,
          );
          const info = (await execute("pdfinfo", [path])).stdout;
          if (template.id.startsWith("article") && engine === "lualatex") {
            assert.match(info, /Tagged:\s+yes/);
            if (process.env.PDF_TEST_VERAPDF) {
              const report = (
                await execute(
                  process.env.PDF_TEST_VERAPDF,
                  ["--flavour", "ua2", "--format", "xml", path],
                  { maxBuffer: 8 * 1024 * 1024 },
                )
              ).stdout;
              assertCompliant(report, "ua2");
            }
          }
          console.log(
            JSON.stringify({
              template: template.id,
              engine,
              bytes: result.pdf.length,
            }),
          );
        }
      }
      const cancelled = new AbortController();
      cancelled.abort(new Error("cancelled"));
      await assert.rejects(
        compileJob(
          validateRequest({ markdown: "# Cancelled" }),
          cancelled.signal,
          { image: process.env.PDF_TEST_WORKER_IMAGE, jobDirectory },
        ),
      );
      assert.deepEqual(
        await readdir(jobDirectory),
        [],
        "Cancelled jobs must remove temporary files",
      );
    } finally {
      await rm(jobDirectory, { recursive: true, force: true });
      if (!process.env.PDF_TEST_ARTIFACTS)
        await rm(artifacts, { recursive: true, force: true });
    }
  },
);

test(
  "LuaLaTeX keeps every token of a long code line instead of clipping it (#133)",
  { skip: !process.env.PDF_TEST_WORKER_IMAGE, timeout: 180000 },
  async () => {
    const jobDirectory = await mkdtemp(join(tmpdir(), "pdf-code-jobs-"));
    const tokens = Array.from(
      { length: 50 },
      (_, index) => `token${String(index).padStart(2, "0")}`,
    );
    const markdown = `---\ntitle: Long code line\nlanguage: en\nauthors:\n  - name: Ada\n---\n\n\`\`\`text\n${tokens.join(" ")}\n\`\`\`\n`;
    try {
      const result = await compileJob(
        validateRequest({ markdown, template: "article", engine: "lualatex" }),
        new AbortController().signal,
        {
          image: process.env.PDF_TEST_WORKER_IMAGE,
          assetBase: "https://fixture.invalid/",
          jobDirectory,
        },
      );
      const path = join(jobDirectory, "long-code.pdf");
      await writeFile(path, result.pdf);
      const text = (await execute("pdftotext", [path, "-"])).stdout;
      const kept = tokens.filter((token) => text.includes(token));
      // verbatim shipped the overflow past the page edge; Poppler dropped it.
      assert.equal(kept.length, tokens.length, `kept ${kept.length} of 50`);
    } finally {
      await rm(jobDirectory, { recursive: true, force: true });
    }
  },
);

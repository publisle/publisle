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
import { compileJob } from "../server.mjs";
import { validateRequest, TEMPLATES } from "../limits.mjs";
import { assertCompliant } from "../../../tools/validate-pdf-ua.mjs";
const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");
const nativeTemplates = TEMPLATES.map((template) => template.id);

test(
  "native profiles preserve content, logical Arabic structure, tags and PDF/UA-2",
  {
    skip: !process.env.PDF_TEST_NATIVE_WORKER_IMAGE,
    timeout: 300000,
  },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), "publisle-native-test-"));
    const artifacts = process.env.PDF_TEST_ARTIFACTS ?? temporary;
    await mkdir(artifacts, { recursive: true });
    const jobDirectory = join(temporary, "jobs");
    await mkdir(jobDirectory);
    const png = await readFile(
      join(root, "examples/articles/paper-convergence.png"),
    );
    const images = {
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      download: async () => ({ bytes: png, mime: "image/png" }),
    };
    const options = {
      image: process.env.PDF_TEST_NATIVE_WORKER_IMAGE,
      nativeImage: process.env.PDF_TEST_NATIVE_WORKER_IMAGE,
      nativeTemplates,
      assetBase: "https://fixture.invalid/",
      imageDependencies: images,
      jobDirectory,
    };
    try {
      for (const template of nativeTemplates) {
        const arabic = template === "article-arabic";
        let markdown = await readFile(
          join(
            root,
            "examples/articles",
            arabic ? "article-arabic.md" : "ieee-journal.md",
          ),
          "utf8",
        );
        markdown = markdown.replaceAll(
          'src="ieee-square-wave.pdf"',
          'src="https://fixture.invalid/plot.png"',
        );
        markdown += arabic
          ? "\n\nالعَرَبِيَّة لا للاختبار.\n"
          : "\n\nUnicode ligatures: office affinity.\n";
        const result = await compileJob(
          validateRequest(
            { markdown, template, engine: "rust", data: { country: "Jordan" } },
            nativeTemplates,
          ),
          new AbortController().signal,
          options,
        );
        assert.deepEqual(await readdir(jobDirectory), []);
        const path = join(artifacts, `native-${template}.pdf`);
        await writeFile(path, result.pdf);
        const text = (await execute("pdftotext", [path, "-"])).stdout
          .normalize("NFKC")
          .replace(/[\u202a-\u202e\u2066-\u2069]/g, "");
        assert.ok(text.includes("1949"), "Resolved bibliography must survive");
        if (arabic) {
          assert.ok(text.includes("اختبار النشر العلمي وإتاحة المحتوى"), text);
          assert.ok(text.includes("العَرَبِيَّة لا للاختبار."), text);
          const { getDocument } =
            await import("pdfjs-dist/legacy/build/pdf.mjs");
          const loading = getDocument({
            data: new Uint8Array(result.pdf),
            useSystemFonts: false,
            isEvalSupported: false,
          });
          try {
            const document = await loading.promise;
            const pages = [];
            const structure = [];
            for (let page = 1; page <= document.numPages; page++) {
              const pdfPage = await document.getPage(page);
              const content = await pdfPage.getTextContent();
              structure.push(await pdfPage.getStructTree());
              pages.push(content.items.map((item) => item.str ?? "").join(" "));
            }
            // Check ActualText directly; pdfinfo -struct-text prints the
            // visual content sequence rather than these structure values.
            const logical = JSON.stringify(structure);
            assert.ok(logical.includes("العَرَبِيَّة"), logical);
            assert.ok(logical.includes("للاختبار"), logical);
            const copied = pages
              .join(" ")
              .normalize("NFKC")
              .replace(/\s+/gu, " ");
            for (const expected of [
              "اختبار النشر العلمي وإتاحة المحتوى",
              "العَرَبِيَّة لا للاختبار.",
            ])
              assert.ok(copied.includes(expected.normalize("NFKC")), copied);
          } finally {
            await loading.destroy();
          }
        } else assert.ok(text.includes("office affinity"), text);
        const info = (await execute("pdfinfo", [path])).stdout;
        assert.match(info, /Tagged:\s+yes/);
        assert.match(info, /PDF version:\s+2\.0/);
        if (process.env.PDF_TEST_VERAPDF) {
          const report = (
            await execute(
              process.env.PDF_TEST_VERAPDF,
              ["--flavour", "ua2", "--format", "xml", path],
              { maxBuffer: 8 * 1024 * 1024 },
            )
          ).stdout;
          await writeFile(
            join(artifacts, `native-${template}.validation.xml`),
            report,
          );
          assertCompliant(report, "ua2");
        }
      }
      await assert.rejects(
        compileJob(
          validateRequest(
            { markdown: "# Unsupported\n\n$\\input{secrets}$", engine: "rust" },
            nativeTemplates,
          ),
          new AbortController().signal,
          options,
        ),
      );
      const cancelled = new AbortController();
      cancelled.abort(new Error("cancelled"));
      await assert.rejects(
        compileJob(
          validateRequest(
            { markdown: "# Cancelled", engine: "rust" },
            nativeTemplates,
          ),
          cancelled.signal,
          options,
        ),
      );
      assert.deepEqual(await readdir(jobDirectory), []);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

test(
  "native 0.6.3 keeps tabs and emoji, and compiles a 12-column table without LuaLaTeX",
  {
    skip: !process.env.PDF_TEST_NATIVE_WORKER_IMAGE,
    timeout: 180000,
  },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), "publisle-native-wide-"));
    const jobs = join(temporary, "jobs");
    await mkdir(jobs);
    const header =
      "---\ntitle: Native regression\nlanguage: en\nauthors:\n  - name: Ada\n---\n\n";
    const row = (cell) =>
      `| ${Array.from({ length: 12 }, (_, index) => cell(index)).join(" | ")} |`;
    const table = [
      row((index) => `Column heading ${index + 1}`),
      row(() => "---"),
      row((index) => `value-${index + 1}`),
    ].join("\n");
    const options = {
      nativeImage: process.env.PDF_TEST_NATIVE_WORKER_IMAGE,
      nativeTemplates: ["article"],
      image: process.env.PDF_TEST_NATIVE_WORKER_IMAGE,
      jobDirectory: jobs,
      assetBase: "https://fixture.invalid/",
    };
    const compile = async (markdown) =>
      compileJob(
        validateRequest({ markdown, engine: "rust" }, ["article"]),
        new AbortController().signal,
        options,
      );
    const extract = async (name, result) => {
      const path = join(temporary, name);
      await writeFile(path, result.pdf);
      return (await execute("pdftotext", [path, "-"])).stdout.normalize("NFKC");
    };
    try {
      // 0.6.2 replaced the tab with U+FFFD and dropped what followed.
      const tabs = await compile(
        `${header}\`\`\`text\nkeyword\tvalue\n\`\`\`\n\nEmoji \u{1F600} stays.\n`,
      );
      const tabText = await extract("tabs.pdf", tabs);
      assert(!tabText.includes("\uFFFD"), tabText);
      assert.match(tabText, /keyword\s+value/u);
      assert(tabText.includes("\u{1F600}"), tabText);

      // 0.6.3 no longer shrinks the table below 0.6, and splits overlong words.
      // The result is a native PDF; a LuaLaTeX retry or an error is a regression.
      const wide = await compile(`${header}${table}\n`);
      assert(
        !wide.diagnostics.some(
          (entry) => entry.code === "native-engine-fallback",
        ),
        JSON.stringify(wide.diagnostics),
      );
      assert.equal(wide.pdf.subarray(0, 8).toString(), "%PDF-2.0");
      const wideText = await extract("wide.pdf", wide);
      assert(!wideText.includes("\uFFFD"), wideText);
      assert.deepEqual(await readdir(jobs), []);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

// Poppler and PDF.js extraction are checked above. Interactive Acrobat selection
// still needs independent evidence before the full Arabic readiness gate closes.
test.todo(
  "native Arabic selection preserves ligatures and diacritics in Acrobat",
);

test(
  "hosted native SVG figures retain searchable labels, symbols and vector artwork",
  {
    skip: !process.env.PDF_TEST_NATIVE_WORKER_IMAGE,
    timeout: 180000,
  },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), "publisle-native-svg-"));
    const artifacts = process.env.PDF_TEST_ARTIFACTS ?? temporary;
    const jobs = join(temporary, "jobs");
    await mkdir(jobs);
    await mkdir(artifacts, { recursive: true });
    const figures = [
      "fft-spectrum.svg",
      "fft-spectrum-dark.svg",
      "gibbs-overshoot.svg",
      "gibbs-overshoot-dark.svg",
    ];
    const markdown = `---\ntitle: Native SVG regression\nauthors:\n  - name: Ada\n---\n\n# Results\n\n${figures.map((name) => `![${name}](https://fixture.invalid/${name})`).join("\n\n")}`;
    try {
      const result = await compileJob(
        validateRequest({ markdown, engine: "rust" }, ["article"]),
        new AbortController().signal,
        {
          nativeImage: process.env.PDF_TEST_NATIVE_WORKER_IMAGE,
          nativeTemplates: ["article"],
          image: process.env.PDF_TEST_NATIVE_WORKER_IMAGE,
          jobDirectory: jobs,
          imageDependencies: {
            resolve: async () => [{ address: "93.184.216.34", family: 4 }],
            download: async ({ url }) => ({
              bytes: await readFile(
                join(root, "sites/www/public", url.pathname.slice(1)),
              ),
              mime: "image/svg+xml",
            }),
          },
        },
      );
      const path = join(artifacts, "native-svg-figures.pdf");
      await writeFile(path, result.pdf);
      const text = (await execute("pdftotext", [path, "-"])).stdout.normalize(
        "NFKC",
      );
      assert.equal(text.match(/frequency bin k/gu)?.length, 2, text);
      assert.equal(text.match(/fifteen-term partial sum/gu)?.length, 2, text);
      for (const expected of ["|X[2]| = 4", "|X[6]| = 4", "π/16", "−π"])
        assert(text.includes(expected), text);
      assert(!text.includes("\uFFFD") && !text.includes("□"), text);
      const images = (await execute("pdfimages", ["-list", path])).stdout
        .trim()
        .split("\n");
      assert.equal(
        images.length,
        2,
        "These SVG figures must remain vectors, not full-figure raster images",
      );
      if (process.env.PDF_TEST_VERAPDF) {
        const report = (
          await execute(
            process.env.PDF_TEST_VERAPDF,
            ["--flavour", "ua2", "--format", "xml", path],
            { maxBuffer: 8 * 1024 * 1024 },
          )
        ).stdout;
        await writeFile(
          join(artifacts, "native-svg-figures.validation.xml"),
          report,
        );
        assertCompliant(report, "ua2");
      }
      assert.deepEqual(await readdir(jobs), []);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createBlock } from "@publisle/schema";
import { fromMarkdown } from "../../markdown/src/index.ts";
import { createLatexPackage } from "../src/package.ts";
import { compileLatexPackage, writeLatexPackage } from "../src/node.ts";
import { template, arabicTemplate } from "../../template-article/src/index.ts";

const execute = promisify(execFile);
const articles = new URL("../../../examples/articles/", import.meta.url)
  .pathname;
const validator = new URL("../../../tools/validate-pdf-ua.mjs", import.meta.url)
  .pathname;
for (const [profile, standard] of [
  [template, "ua-2"],
  [arabicTemplate, "ua-2"],
  [template, "ua-1"],
] as const) {
  it(`compiles ${profile.id} with language, figures, table headers and MathML and passes veraPDF ${standard}`, async () => {
    const rtl = profile.id === "article-arabic";
    const loaded = fromMarkdown(
      await readFile(
        join(articles, rtl ? "article-arabic.md" : "ieee-journal.md"),
        "utf8",
      ),
    );
    if (!loaded.document) throw new Error("Invalid fixture");
    const input = {
      ...loaded.document,
      metadata: {
        ...loaded.document.metadata,
        language: rtl ? "ar" : "en",
        direction: rtl ? ("rtl" as const) : ("ltr" as const),
      },
      blocks: [
        ...loaded.document.blocks,
        createBlock({
          type: "publisle:paragraph",
          data: {
            content: [
              {
                type: "text",
                value: "English. مرحبا بالعالم. 中文研究论文测试. ",
              },
              { type: "inlineMath", value: "x^2+1" },
            ],
          },
        }),
        createBlock({
          type: "publisle:code",
          data: {
            value: `${Array.from({ length: 50 }, (_, index) => `token${String(index).padStart(2, "0")}`).join(" ")}\n\nnext line`,
          },
        }),
      ],
    };
    const source = createLatexPackage(input, {
      template: profile,
      pdfUa: standard,
    });
    expect(source.pdfStandard).toBe(standard);
    const image = process.env["PUBLISLE_COMPILER_IMAGE"];
    const compiled = await compileLatexPackage(source, {
      sourceDirectory: articles,
      compiler: "container",
      ...(image ? { containerImage: image } : {}),
      timeoutMs: 180_000,
    });
    const artifacts = process.env["PUBLISLE_RESEARCH_ARTIFACTS"];
    if (artifacts) await mkdir(artifacts, { recursive: true });
    const directory = await mkdtemp(
      join(artifacts ?? tmpdir(), `publisle-${profile.id}-${standard}-`),
    );
    try {
      const output = join(directory, "package");
      await writeLatexPackage(compiled, output);
      const pdf = join(output, "manuscript.pdf");
      expect(new TextDecoder().decode(compiled.pdf.slice(0, 8))).toBe(
        standard === "ua-2" ? "%PDF-2.0" : "%PDF-1.7",
      );
      const info = (await execute("pdfinfo", [pdf])).stdout;
      expect(info).toMatch(/Tagged:\s+yes/u);
      const structure = (await execute("pdfinfo", ["-struct", pdf])).stdout;
      expect(structure).toMatch(/TH .*\n\s+\/Scope \/Column/u);
      expect(structure).toContain("Figure <");
      expect(structure).toContain("Formula <");
      const metadata = (await execute("pdfinfo", ["-meta", pdf])).stdout;
      expect(metadata).toContain(`<rdf:li>${rtl ? "ar" : "en"}</rdf:li>`);
      const attachments = join(directory, "mathml");
      await mkdir(attachments);
      await execute("pdfdetach", ["-saveall", "-o", attachments, pdf]);
      const math = await readFile(join(attachments, "mathml-3.xml"), "utf8");
      expect(math).toContain("http://www.w3.org/1998/Math/MathML");
      expect(math).toMatch(/<msup[\s>]/u);
      const text = (
        await execute("pdftotext", ["-layout", pdf, "-"])
      ).stdout.normalize("NFKC");
      expect(text).toContain("中文研究论文测试");
      expect(text).toContain("مرحبا بالعالم");
      expect(text).toContain("token49");
      // Arabic extraction reverses Latin word order on this line.
      expect(text).toMatch(/next line|line next/u);
      await execute(
        process.execPath,
        [
          validator,
          pdf,
          "--validator",
          process.env["VERAPDF"] ?? "verapdf",
          "--flavour",
          standard === "ua-2" ? "ua2" : "ua1",
          "--report",
          join(output, `verapdf-${standard}.xml`),
        ],
        { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
      );
      const report = await readFile(
        join(output, `verapdf-${standard}.xml`),
        "utf8",
      );
      expect(report).toContain('isCompliant="true"');
    } finally {
      if (!artifacts) await rm(directory, { recursive: true, force: true });
    }
  });
}

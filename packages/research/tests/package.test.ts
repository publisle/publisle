/* eslint-disable @typescript-eslint/no-deprecated -- exercises explicit legacy migration behavior */
import { readFile } from "node:fs/promises";
import { createBlock, document } from "@publisle/schema";
import { fromMarkdown } from "../../markdown/src/index.ts";
import { describe, expect, it } from "vitest";
import { createLatexPackage as createPackage } from "../src/package.ts";
import { template } from "../../template-ieee/src/index.ts";
const createLatexPackage: typeof createPackage = (document, options) =>
  createPackage(document, { template, ...options });
import { latexKey, latexText, toLatex } from "../src/latex.ts";
import { resolveDocument } from "../src/resolve.ts";
import { toPdf } from "../src/pdf.ts";

async function fixture(name = "ieee-journal") {
  const source = await readFile(
    new URL(`../../../examples/articles/${name}.md`, import.meta.url),
    "utf8",
  );
  const result = fromMarkdown(source);
  if (!result.document) throw new Error("Fixture did not parse");
  return result.document;
}

describe("IEEE journal source packages", () => {
  it("declares color support only when authored math uses it", () => {
    const article = fromMarkdown(
      "---\ntitle: Colored math\nauthors:\n  - name: Ada\n---\n\n$$\n\\textcolor{RoyalBlue}{x}+\\color{ForestGreen} y\n$$\n",
    ).document;
    if (!article) throw new Error("Fixture import failed");
    const source = createPackage(article);
    expect(source.files["manuscript.tex"]).toContain(
      "\\PassOptionsToPackage{dvipsnames,svgnames}{xcolor}",
    );
    expect(source.requirements).toContain("xcolor.sty");
    const plain = createPackage({ ...article, blocks: [] });
    expect(plain.requirements).not.toContain("xcolor.sty");
  });

  it("preserves journal structure, assets, captions, affiliations and source references", async () => {
    const result = createLatexPackage(await fixture());
    const tex = result.files["manuscript.tex"] ?? "";
    expect(tex).toContain(
      "\\documentclass[journal,10pt,letterpaper]{IEEEtran}",
    );
    expect(tex).toContain("\\thanks{Ada Example is with");
    expect(tex).toContain("\\begin{IEEEkeywords}");
    expect(tex).toContain("\\begin{equation}");
    expect(tex).toContain("\\label{eq:approximation}");
    expect(tex).toContain("\\ref{eq:approximation}");
    expect(tex).toContain(
      "\\includegraphics[width=\\columnwidth]{assets/figure-1.pdf}",
    );
    expect(tex).toContain("\\begin{tabularx}{\\columnwidth}{XX}");
    expect(tex).toContain("\\begin{table}[!htbp]");
    expect(tex.indexOf("\\FloatBarrier")).toBeGreaterThan(
      tex.indexOf("\\end{table}"),
    );
    expect(tex.indexOf("\\FloatBarrier")).toBeLessThan(
      tex.indexOf("\\bibliography{references}"),
    );
    expect(result.files["placeins.sty"]).toContain(
      "freely released to the public domain",
    );
    expect(tex).toContain("\\textbf{Odd harmonics N}");
    expect(tex).toContain("\\footnote{This manuscript");
    expect(tex).toContain("\\bibliographystyle{IEEEtran}");
    expect(tex.match(/\\cite\{shannon1949\}/gu)).toHaveLength(2);
    expect(result.files["references.bib"]).toContain(
      "10.1109/JRPROC.1949.232969",
    );
    expect(result.assets).toEqual([
      { source: "ieee-square-wave.pdf", destination: "assets/figure-1.pdf" },
    ]);
    expect(result.diagnostics.map((loss) => loss.code)).toEqual([
      "pdf-ua-unavailable",
    ]);
    expect(
      toPdf(resolveDocument(await fixture())).losses.map((loss) => loss.code),
    ).toContain("table-rendered-as-text");
  });

  it("keeps figures, tables, and display math out of the abstract region", () => {
    const result = createLatexPackage(
      document({
        metadata: {
          title: "Float order",
          authors: [{ name: "Ada Example" }],
          subjects: ["Testing"],
        },
        blocks: [
          createBlock({
            type: "publisle:heading",
            data: {
              level: 1,
              content: [{ type: "text", value: "Abstract" }],
              role: "abstract",
            },
          }),
          createBlock({
            type: "publisle:paragraph",
            data: { content: [{ type: "text", value: "Prose abstract." }] },
          }),
          createBlock({
            type: "publisle:figure",
            data: {
              src: "ieee-square-wave.pdf",
              alt: "A square wave plot",
              caption: [
                {
                  type: "paragraph",
                  content: [{ type: "text", value: "A plot." }],
                },
              ],
            },
          }),
          createBlock({
            type: "publisle:paragraph",
            data: { content: [{ type: "text", value: "Body text." }] },
          }),
        ],
      }),
    );
    const tex = result.files["manuscript.tex"] ?? "";
    const abstractStart = tex.indexOf("\\begin{abstract}");
    const abstractEnd = tex.indexOf("\\end{abstract}");
    const figureBegin = tex.indexOf("\\begin{figure}");
    expect(abstractStart).toBeGreaterThan(-1);
    expect(abstractEnd).toBeGreaterThan(abstractStart);
    expect(figureBegin).toBeGreaterThan(abstractEnd);
    expect(tex.slice(abstractStart, abstractEnd)).not.toContain(
      "\\begin{figure}",
    );
    expect(tex).toContain("\\begin{figure}[!tb]");
    // flafter guarantees floats never rise above their source position.
    expect(tex).toContain("\\usepackage{flafter}");
    expect(result.requirements).toContain("flafter.sty");
  });

  it("locks the IEEE title area with \\IEEEpeerreviewmaketitle after the keywords", async () => {
    const files = createLatexPackage(await fixture()).files;
    const tex = files["manuscript.tex"] ?? "";
    const keywordsEnd = tex.indexOf("\\end{IEEEkeywords}");
    const lock = tex.indexOf("\\IEEEpeerreviewmaketitle");
    expect(keywordsEnd).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(keywordsEnd);
    expect(tex.indexOf("\\section")).toBeGreaterThan(lock);
  });

  it("keeps multilingual text and direction for LuaLaTeX and rejects pdfLaTeX substitution", async () => {
    const input = await fixture("ieee-unicode");
    expect(() => createLatexPackage(input)).toThrow(/lualatex/u);
    const result = createLatexPackage(input, { engine: "lualatex" });
    expect(result.files["manuscript.tex"]).toContain(
      "\\foreignlanguage{arabic}{مرحبا بالعالم هذا اختبار للنشر العلمي}",
    );
    expect(result.files["manuscript.tex"]).toContain(
      "\\cjkfont 中文研究论文测试",
    );
    expect(result.files["manuscript.tex"]).toContain("\\(\\sum\\)");
    expect(result.files["manuscript.tex"]).not.toContain("amssymb");
    expect(result.fonts).toMatchObject({
      arabic: "PakType Naskh Basic",
      cjk: "FandolSong",
    });
  });

  it("escapes data once and maps unsafe keys without collisions or breaking existing keys", () => {
    expect(latexText("Ada & {A} \\ 50% #_~^")).toBe(
      "Ada \\& \\{A\\} \\textbackslash{} 50\\% \\#\\_\\textasciitilde{}\\textasciicircum{}",
    );
    expect(latexKey("doe2020")).toBe("doe2020");
    expect(latexKey("a,b")).not.toBe(latexKey("a b"));
    expect(latexKey(latexKey("a,b"))).not.toBe(latexKey("a,b"));
    const input = document({
      metadata: { title: "A & B", authors: [{ name: "A & B" }] },
      blocks: [],
    });
    expect(toLatex(resolveDocument(input))).toContain("\\author{A \\& B}");
  });

  it("rejects missing citations, labels, footnotes and unsupported assets", async () => {
    const input = await fixture();
    for (const inline of [
      { type: "citationReference", items: [{ id: "missing" }] },
      { type: "crossReference", target: "missing" },
      { type: "footnoteReference", identifier: "missing" },
    ]) {
      const changed = {
        ...input,
        blocks: [
          ...input.blocks,
          createBlock({
            type: "publisle:paragraph",
            data: { content: [inline] },
          }),
        ],
      };
      expect(() => createLatexPackage(changed)).toThrow(/Unresolved/u);
    }
    // HTTPS figures are fetched at package time (see figures.test.ts);
    // non-HTTPS schemes and unsupported local formats still reject.
    const httpsPackage = createLatexPackage({
      ...input,
      blocks: [
        ...input.blocks,
        createBlock({
          type: "publisle:figure",
          data: { src: "https://example.org/figure.png", alt: "A figure" },
        }),
      ],
    });
    expect(httpsPackage.assets).toContainEqual(
      expect.objectContaining({ source: "https://example.org/figure.png" }),
    );
    for (const src of [
      "http://example.org/figure.png",
      "figure.svg",
      "figure.tiff",
    ]) {
      expect(() =>
        createLatexPackage({
          ...input,
          blocks: [
            ...input.blocks,
            createBlock({
              type: "publisle:figure",
              data: { src, alt: "A figure" },
            }),
          ],
        }),
      ).toThrow(/figure asset|HTTPS/iu);
    }
  });

  it("rejects malformed tables and recursive notes before compiling", async () => {
    const input = await fixture();
    expect(() =>
      createLatexPackage({
        ...input,
        blocks: [
          ...input.blocks,
          createBlock({ type: "publisle:table", data: { rows: [[], []] } }),
        ],
      }),
    ).toThrow(/rectangular/u);
    expect(() =>
      createLatexPackage({
        ...input,
        blocks: [
          ...input.blocks,
          createBlock({
            type: "publisle:footnote",
            data: {
              identifier: "cycle",
              children: [
                {
                  type: "paragraph",
                  content: [{ type: "footnoteReference", identifier: "cycle" }],
                },
              ],
            },
          }),
          createBlock({
            type: "publisle:paragraph",
            data: {
              content: [{ type: "footnoteReference", identifier: "cycle" }],
            },
          }),
        ],
      }),
    ).toThrow(/Recursive footnote/u);
  });
  it("preserves opaque entries and rejects incompatible citation styles", async () => {
    const input = await fixture();
    expect(() =>
      createLatexPackage(input, {
        style: "author-date",
      }),
    ).toThrow(/numeric/u);
    expect(
      createLatexPackage({
        ...input,
        blocks: [
          ...input.blocks,
          createBlock({
            type: "publisle:bibliography",
            data: {
              entries: [{ id: "raw", raw: "Opaque literal reference" }],
            },
          }),
        ],
      }).diagnostics.map((item) => item.code),
    ).toContain("opaque-reference-literal");
  });
});

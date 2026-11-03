import { describe, expect, it } from "vitest";
import { template } from "@publisle/template-article";
import type { Article, TemplateContext } from "@publisle/template-sdk";

const context: TemplateContext = {
  style: "numeric",
  citationForm: "numeric",
  citations: [],
  bibliography: [],
  engine: "lualatex",
  pdfUa: false,
};
const article = (
  align?: readonly ("left" | "center" | "right" | null)[],
): Article => ({
  title: "Alignment",
  authors: ["Ada"],
  entries: [],
  losses: [],
  subjects: [],
  blocks: [
    {
      kind: "table",
      abstract: false,
      headerRows: 1,
      ...(align ? { align } : {}),
      rows: [
        ["Left", "Center", "Right"],
        ["L", "C", "R"],
      ].map((row) => row.map((value) => [{ type: "text" as const, value }])),
    },
  ],
});

describe("shared LaTeX table alignment", () => {
  for (const pdfUa of [false, "ua-1", "ua-2"] as const) {
    it(`honors authored column alignment with pdfUa=${String(pdfUa)}`, () => {
      const output = template.render(article(["left", "center", "right"]), {
        ...context,
        pdfUa,
      });
      const tex = output.files["manuscript.tex"];
      expect(tex).toContain(
        "{>{\\raggedright\\arraybackslash}X>{\\centering\\arraybackslash}X>{\\raggedleft\\arraybackslash}X}",
      );
      expect(tex).toContain("L & C & R \\\\");
      if (pdfUa) expect(tex).toContain("\\tagpdfsetup{table/header-rows={1}}");
    });
  }
  it("retains the default columns for absent, null and unspecified alignments", () => {
    expect(
      template.render(article(), context).files["manuscript.tex"],
    ).toContain("{XXX}");
    expect(
      template.render(article([null, "right"]), context).files[
        "manuscript.tex"
      ],
    ).toContain("{X>{\\raggedleft\\arraybackslash}XX}");
  });

  it("omits an empty caption and still numbers a labeled table", () => {
    const source = article().blocks.find((block) => block.kind === "table");
    if (!source || source.kind !== "table")
      throw new Error("Missing table fixture");
    const tex =
      template.render(article(), context).files["manuscript.tex"] ?? "";
    expect(tex).toContain("\\begin{table}");
    expect(tex).not.toContain("\\caption");
    const render = (
      table: Extract<Article["blocks"][number], { kind: "table" }>,
    ) =>
      template.render(
        {
          title: "Alignment",
          authors: ["Ada"],
          entries: [],
          losses: [],
          subjects: [],
          blocks: [table],
        },
        context,
      ).files["manuscript.tex"] ?? "";
    const labeled = render({ ...source, label: "results" });
    expect(labeled).toContain("\\refstepcounter{table}\\label{results}");
    expect(labeled).not.toContain("\\caption");
    expect(
      render({
        ...source,
        caption: [{ type: "text", value: "Measured values" }],
      }),
    ).toContain("\\caption{Measured values}");
  });

  it("uses content-sized columns once a table reaches eight columns", () => {
    const headings = Array.from(
      { length: 12 },
      (_, index) => `Aa${String(index + 1).padStart(2, "0")}`,
    );
    const rows = [
      headings,
      headings.map((_, index) => `v${String(index + 1)}`),
    ].map((row) => row.map((value) => [{ type: "text" as const, value }]));
    const tex =
      template.render(
        {
          title: "Wide",
          authors: ["Ada"],
          entries: [],
          losses: [],
          subjects: [],
          blocks: [
            {
              kind: "table",
              abstract: false,
              headerRows: 1,
              align: ["center", "right"],
              rows,
            },
          ],
        },
        context,
      ).files["manuscript.tex"] ?? "";
    expect(tex).toContain("\\begin{tabular}{crllllllllll}");
    expect(tex).not.toContain("XXXXXXXXXXXX");
    expect(tex).toContain("\\textbf{Aa01}");
    expect(tex).toContain("\\textbf{Aa12}");
    expect(tex).not.toContain("\\caption");
    expect(tex).not.toContain("\\begin{tabularx}");
  });
});

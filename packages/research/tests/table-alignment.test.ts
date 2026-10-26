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
});

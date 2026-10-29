import { describe, expect, it } from "vitest";
import { template } from "@publisle/template-article";
import type { Article, TemplateContext } from "@publisle/template-sdk";

const context = (engine: "lualatex" | "pdflatex"): TemplateContext => ({
  style: "numeric",
  citationForm: "numeric",
  citations: [],
  bibliography: [],
  engine,
  pdfUa: false,
});

const article = (value: string): Article => ({
  title: "Code",
  authors: ["Ada"],
  entries: [],
  losses: [],
  subjects: [],
  blocks: [{ kind: "code", value, abstract: false }],
});

const listing =
  "\\begin{lstlisting}[breaklines=true,breakatwhitespace=false,columns=fullflexible,keepspaces=true,basicstyle=\\ttfamily\\small,showstringspaces=false]";

describe("LaTeX code listings", () => {
  it("wraps code with listings and declares the package", () => {
    const output = template.render(
      article("keep  spaces\n\nnext"),
      context("pdflatex"),
    );
    const tex = output.files["manuscript.tex"] ?? "";
    expect(tex).toContain("\\usepackage{amsmath,graphicx,listings,tabularx}");
    expect(tex).toContain(
      `${listing}\nkeep  spaces\n\nnext\n\\end{lstlisting}`,
    );
    expect(tex).not.toContain("\\begin{verbatim}");
    expect(tex).not.toContain("\\DeclareInstance{blockenv}{lstlisting}");
    expect(output.requirements).toContain("listings.sty");
  });

  it("tags listings and keeps blank lines from nesting", () => {
    const output = template.render(article("keep\n\n  \nnext"), {
      ...context("lualatex"),
      pdfUa: "ua-2",
    });
    const tex = output.files["manuscript.tex"] ?? "";
    expect(tex).toContain("\\DeclareInstance{blockenv}{lstlisting}{display}");
    expect(tex).toContain("\\lst@AddToHook{PreInit}");
    expect(tex).toContain(
      "\\begin{lstlisting}[breaklines=true,breakatwhitespace=false,columns=fullflexible,keepspaces=true,basicstyle=\\ttfamily\\small,showstringspaces=false]\nkeep\n \n \nnext\n\\end{lstlisting}",
    );
  });

  it("rejects an lstlisting terminator and pdfLaTeX Unicode", () => {
    expect(() =>
      template.render(
        article("before \\end{lstlisting} after"),
        context("lualatex"),
      ),
    ).toThrow("Code contains a verbatim terminator.");
    expect(() =>
      template.render(article("token α"), context("pdflatex")),
    ).toThrow("Unicode code requires LuaLaTeX.");
    expect(
      template.render(article("token α"), context("lualatex")).files[
        "manuscript.tex"
      ],
    ).toContain("token α");
  });
});

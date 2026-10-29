import type {
  Article,
  ArticleInline,
  ArticleListItem,
  CitationEntry,
} from "./article.ts";
import type { LatexEngine, SourcePackage, TemplateContext } from "./index.ts";
import { placeins } from "./placeins.ts";
import { toBibtex } from "./bibtex.ts";
import { latexKey, latexText } from "./escape.ts";

// listings 1.11b opens and closes paragraph hooks unevenly, and a blank line
// nests one codeline inside another. The block hooks come from the frozen
// TeX Live 2025 tagging code (display blockenv, not the later latex-dev
// "std" template). A space keeps a blank line visually empty without nesting.
const listingsTagging = String.raw`\ExplSyntaxOn
\DeclareInstance{blockenv}{lstlisting}{display}
{
  name                   = lstlisting,
  tag-name               = verbatim,
  tag-attr-class         = ,
  tagging-recipe         = standard,
  tagging-suppress-paras = true,
  inner-level-counter    = ,
  increment-level        = false,
  setup-code             = ,
  block-instance         = verbatimblock,
  inner-instance         = ,
  final-code             = \tl_set:Nn \l__tag_para_tag_tl {codeline} \ignorespaces,
}
\ExplSyntaxOff
\makeatletter
\lst@AddToHook{PreInit}{\UseInstance{blockenv}{lstlisting}{}}
\lst@AddToHook{DeInit}{\endblockenv}
\makeatother
`;
function listingSource(value: string, tagged: boolean): string {
  if (!tagged) return value;
  const withoutFinalNewline = value.endsWith("\n") ? value.slice(0, -1) : value;
  return withoutFinalNewline
    .split("\n")
    .map((line) => (line.trim() === "" ? " " : line))
    .join("\n");
}
type WritingDirection = "ltr" | "rtl" | "auto";
export interface LatexProfile {
  /** Only enable after validating the class against the pinned compiler. */
  readonly tagging?: boolean;
  readonly id: string;
  readonly version: string;
  readonly className: string;
  readonly classOptions?: string;
  readonly bibliographyStyle?: string;
  readonly direction?: "ltr" | "rtl";
  readonly defaultEngine?: LatexEngine;
  readonly preamble?: string;
  readonly automaticBibliographyStyle?: boolean;
  readonly numericCitationPackage?: boolean;
  readonly pdfSymbols?: boolean;
  readonly keywords?: (
    subjects: readonly string[],
    text: (value: string) => string,
  ) => string;
  readonly citationCommand?: "cite" | "citep";
  readonly author?: (
    article: Article,
    text: (value: string) => string,
  ) => string;
  readonly frontmatter?: (
    abstract: string,
    article: Article,
    text: (value: string) => string,
  ) => string;
}
export function renderLatexArticle(
  article: Article,
  context: TemplateContext,
  profile: LatexProfile,
): SourcePackage {
  const engine = context.engine ?? profile.defaultEngine ?? "pdflatex";
  const requested =
    context.pdfUa ??
    (context.data && Object.hasOwn(context.data, "pdfUa")
      ? context.data["pdfUa"]
      : "ua-2");
  if (requested !== false && requested !== "ua-1" && requested !== "ua-2")
    throw new Error("pdfUa must be ua-1, ua-2 or false.");
  const pdfStandard =
    profile.tagging && engine === "lualatex" && requested !== false
      ? requested
      : undefined;
  const language =
    article.language ?? (profile.direction === "rtl" ? "ar" : "en");
  if (pdfStandard && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u.test(language))
    throw new Error("Tagged PDF requires a BCP 47 document language.");
  const fonts = {
    latin: context.fonts?.["latin"] ?? "TeX Gyre Termes",
    arabic: context.fonts?.["arabic"] ?? "PakType Naskh Basic",
    cjk: context.fonts?.["cjk"] ?? "FandolSong",
    math: context.fonts?.["math"] ?? "TeX Gyre Termes Math",
  };
  // Loading an unused CJK family materializes large font tables in LuaTeX.
  // Include generated citation text as well as authored content in this check.
  const scriptText = JSON.stringify([
    article,
    context.bibliography,
    context.citations,
  ]);
  const needsColor = /\\(?:textcolor|color|colorbox|fcolorbox)\b/u.test(
    scriptText,
  );
  const needsCjk = /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u.test(
    scriptText,
  );
  const needsArabic =
    profile.direction === "rtl" ||
    /\p{Script=Arabic}/u.test(scriptText) ||
    scriptText.includes('"direction":"rtl"');
  for (const font of Object.values(fonts))
    if (!/^[\p{L}\p{N} .-]+$/u.test(font))
      throw new Error(
        "Font names must contain letters, digits, spaces, dots or hyphens.",
      );
  const text = (value: string, direction?: WritingDirection): string => {
    if (engine === "pdflatex" && /[^\u0020-\u007e\t\n\r]/u.test(value))
      throw new Error(
        "Non-ASCII journal text requires --engine lualatex (no glyph substitution is performed).",
      );
    // Script runs select shaping fonts while the surrounding article stays LTR.
    const escaped = value
      .split(
        /([\p{Script=Arabic}\p{M}\u060c\u061b\u061f]+(?:[ \t]+[\p{Script=Arabic}\p{M}\u060c\u061b\u061f]+)*|[\p{Script=Han}\u3000-\u303f\uff00-\uffef]+)/u,
      )
      .map((run) => {
        const safe = latexText(run);
        if (
          engine === "lualatex" &&
          /[\p{Script=Arabic}\u060c\u061b\u061f]/u.test(run)
        )
          return `\\foreignlanguage{arabic}{${safe}}`;
        if (
          engine === "lualatex" &&
          /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]/u.test(run)
        )
          return `{\\cjkfont ${safe}}`;
        const symbols: Readonly<Record<string, string>> = {
          α: "\\alpha",
          β: "\\beta",
          γ: "\\gamma",
          δ: "\\delta",
          π: "\\pi",
          "∑": "\\sum",
          "∞": "\\infty",
          "≤": "\\leq",
          "≥": "\\geq",
          "±": "\\pm",
          "∈": "\\in",
          "∫": "\\int",
          "√": "\\surd",
        };
        return safe.replace(
          /[\p{Sm}αβγδπ]/gu,
          (symbol) => `\\(${symbols[symbol] ?? symbol}\\)`,
        );
      })
      .join("");
    return direction === "rtl" && engine === "lualatex"
      ? `\\foreignlanguage{arabic}{${escaped}}`
      : escaped;
  };
  const labels = new Set<string>();
  const footnotes = new Map<string, readonly (readonly ArticleInline[])[]>();
  const footnoteNumbers = new Map<string, number>();
  const assets: { source: string; destination: string }[] = [];
  for (const block of article.blocks) {
    if (block.label) {
      if (labels.has(block.label))
        throw new Error(`Duplicate label: ${block.label}`);
      labels.add(block.label);
    }
    if (block.kind === "footnote") {
      if (footnotes.has(block.id))
        throw new Error(`Duplicate footnote: ${block.id}`);
      footnotes.set(block.id, block.paragraphs);
    }
  }
  const activeNotes = new Set<string>();
  let citationIndex = 0;
  let emittedNotes = 0;
  const take = (inlines: readonly ArticleInline[]): string =>
    inlines
      .map((inline) => {
        if (inline.type === "break") return " ";
        if (inline.type === "math") return `\\(${inline.value}\\)`;
        if (inline.type === "citation") {
          const formatted =
            context.citationText?.(inline.cluster) ??
            context.citations[citationIndex++] ??
            "";
          if (!profile.bibliographyStyle) {
            if (context.citationForm === "note" && activeNotes.size === 0) {
              emittedNotes++;
              return `\\footnote{${text(formatted)}}`;
            }
            return text(formatted);
          }
          const locators = inline.cluster.items.filter(
            (item) => item.locator !== undefined,
          );
          if (locators.length > 1)
            throw new Error(
              "BibTeX citation clusters support one locator; split this cluster.",
            );
          if (inline.cluster.items.some((item) => item.suppressAuthor))
            throw new Error(
              "Author suppression is not supported by this numeric BibTeX profile.",
            );
          const locator = locators[0];
          return `${text(inline.cluster.prefix ?? "")}\\${profile.citationCommand ?? "cite"}${locator ? `[${text(`${locator.label ?? "p."} ${locator.locator ?? ""}`)}]` : ""}{${inline.cluster.items.map((item) => latexKey(item.id)).join(",")}}${text(inline.cluster.suffix ?? "")}`;
        }
        if (inline.type === "link")
          return `\\href{${latexText(inline.url)}}{${text(inline.value)}}`;
        if (inline.reference?.kind === "cross") {
          if (!labels.has(inline.reference.target))
            throw new Error(
              `Unresolved cross-reference: ${inline.reference.target}`,
            );
          return inline.value === inline.reference.target
            ? `\\ref{${latexKey(inline.reference.target)}}`
            : `\\hyperref[${latexKey(inline.reference.target)}]{${text(inline.value)}}`;
        }
        if (inline.reference?.kind === "footnote") {
          const id = inline.reference.target;
          const paragraphs = footnotes.get(id);
          if (!paragraphs) throw new Error(`Unresolved footnote: ${id}`);
          if (activeNotes.has(id)) throw new Error(`Recursive footnote: ${id}`);
          const number = footnoteNumbers.get(id);
          if (number !== undefined) return `\\footnotemark[${String(number)}]`;
          footnoteNumbers.set(id, ++emittedNotes);
          activeNotes.add(id);
          const value = paragraphs.map(take).join(" ");
          activeNotes.delete(id);
          return `\\footnote{${value}}`;
        }
        const value = text(inline.value, inline.direction);
        const command =
          inline.mark === "strong"
            ? "textbf"
            : inline.mark === "emphasis"
              ? "emph"
              : inline.mark === "code"
                ? "texttt"
                : inline.mark === "strike"
                  ? "sout"
                  : undefined;
        return command ? `\\${command}{${value}}` : value;
      })
      .join("");
  const abstract: string[] = [];
  const body: string[] = [];
  const firstHeadingLevel = Math.min(
    ...article.blocks.flatMap((block) =>
      block.kind === "heading" && !block.abstract ? [block.level] : [],
    ),
  );
  for (const block of article.blocks) {
    // Floating environments never join the abstract: a [!t] float inside the
    // abstract would be hoisted above it on the first page.
    const target =
      "abstract" in block &&
      block.abstract &&
      block.kind !== "figure" &&
      block.kind !== "table"
        ? abstract
        : body;
    const label = block.label ? `\\label{${latexKey(block.label)}}` : "";
    if (block.kind === "heading") {
      if (!block.abstract)
        target.push(
          `\\${block.level <= firstHeadingLevel ? "section" : block.level === firstHeadingLevel + 1 ? "subsection" : "subsubsection"}{${take(block.inlines)}}${label}`,
        );
    } else if (block.kind === "paragraph") target.push(take(block.inlines));
    else if (block.kind === "math")
      target.push(
        block.display
          ? `\\begin{equation}${block.value}${label}\\end{equation}`
          : `\\(${block.value}\\)`,
      );
    else if (block.kind === "figure") {
      if (pdfStandard && !block.alt.trim())
        throw new Error("Tagged PDF figures require alternative text.");
      const remote = /^(?:[a-z]+:|\/\/)/iu.test(block.src);
      if (remote && !block.src.startsWith("https://"))
        throw new Error(`Remote figure assets require HTTPS: ${block.src}`);
      const extension = remote
        ? /\.(pdf|png|jpe?g|svg)(?:[?#]|$)/iu
            .exec(block.src)?.[1]
            ?.toLowerCase()
        : /\.(pdf|png|jpe?g)$/iu.exec(block.src)?.[1]?.toLowerCase();
      if (!extension)
        throw new Error(
          remote
            ? `Remote figure URLs must end in PDF, PNG, JPEG or SVG: ${block.src}`
            : `Unsupported figure asset (use PDF, PNG or JPEG): ${block.src}`,
        );
      // Self-contained remote SVGs are rasterized to PNG at package time.
      const destination = `assets/figure-${String(assets.length + 1)}.${remote && extension === "svg" ? "png" : extension}`;
      assets.push({ source: block.src, destination });
      target.push(
        `\\begin{figure}[!tb]\n\\centering\n\\includegraphics[width=\\columnwidth${pdfStandard ? `,alt={${latexText(block.alt)}}` : ""}]{${destination}}\n\\caption{${take(block.caption)}}${label}\n\\end{figure}`,
      );
    } else if (block.kind === "table") {
      const width = block.rows[0]?.length ?? 0;
      if (width === 0 || block.rows.some((row) => row.length !== width))
        throw new Error("Journal tables must be nonempty and rectangular.");
      if (
        pdfStandard &&
        (!Number.isInteger(block.headerRows) ||
          (block.headerRows ?? 0) < 1 ||
          (block.headerRows ?? 0) > block.rows.length)
      )
        throw new Error("Tagged PDF tables require valid headerRows.");
      const rows = block.rows
        .map(
          (row, index) =>
            row
              .map((cell) =>
                index < (block.headerRows ?? 0)
                  ? `\\textbf{${take(cell)}}`
                  : take(cell),
              )
              .join(" & ") + " \\\\",
        )
        .join("\n");
      const columns = Array.from({ length: width }, (_, index) => {
        const align = block.align?.[index];
        const command =
          align === "left"
            ? "raggedright"
            : align === "center"
              ? "centering"
              : align === "right"
                ? "raggedleft"
                : undefined;
        return command ? `>{\\${command}\\arraybackslash}X` : "X";
      }).join("");
      target.push(
        `\\begin{table}[!htbp]\n\\caption{${take(block.caption ?? [])}}${label}\n\\centering\n${pdfStandard ? `\\tagpdfsetup{table/header-rows={${Array.from({ length: block.headerRows ?? 0 }, (_, index) => String(index + 1)).join(",")}}}\n` : ""}\\begin{tabularx}{\\columnwidth}{${columns}}\n\\hline\n${rows}\n\\hline\n\\end{tabularx}\n\\end{table}`,
      );
    } else if (block.kind === "list") {
      const renderList = (
        list: {
          readonly ordered: boolean;
          readonly start?: number;
          readonly items: readonly (
            readonly ArticleInline[] | ArticleListItem
          )[];
        },
        depth: number,
      ): string => {
        const environment = list.ordered ? "enumerate" : "itemize";
        const counter = `enum${"i".repeat(Math.min(depth + 1, 4))}`;
        const opening =
          list.ordered && typeof list.start === "number" && list.start !== 1
            ? `\\begin{enumerate}\\setcounter{${counter}}{${String(list.start - 1)}}\n`
            : `\\begin{${environment}}\n`;
        const items = list.items
          .map((item) => {
            const content = "content" in item ? take(item.content) : take(item);
            const nested =
              "content" in item
                ? (item.children ?? [])
                    .map((child) => renderList(child, depth + 1))
                    .join("")
                : "";
            return `\\item ${content}${nested}`;
          })
          .join("\n");
        return `${opening}${items}\n\\end{${environment}}`;
      };
      target.push(renderList(block, 0));
    } else if (block.kind === "quote")
      target.push(
        `\\begin{quote}${block.paragraphs.map(take).join("\n\n")}\\end{quote}`,
      );
    else if (block.kind === "code") {
      // lstlisting terminates at this control sequence, the same way verbatim
      // terminated at \end{verbatim}. Reject it before it can close the listing.
      if (block.value.includes("\\end{lstlisting}"))
        throw new Error("Code contains a verbatim terminator.");
      if (engine === "pdflatex" && /[^\u0020-\u007e\t\n\r]/u.test(block.value))
        throw new Error("Unicode code requires LuaLaTeX.");
      // breaklines keeps a long physical line inside the text block. verbatim
      // ships the overflow past the page edge, where Poppler drops it.
      target.push(
        `\\begin{lstlisting}[breaklines=true,breakatwhitespace=false,columns=fullflexible,keepspaces=true,basicstyle=\\ttfamily\\small,showstringspaces=false]\n${listingSource(block.value, pdfStandard !== undefined)}\n\\end{lstlisting}`,
      );
    }
  }
  const unicodePreamble =
    engine === "lualatex"
      ? `\\usepackage{fontspec}
\\setmainfont{${fonts.latin}}
\\usepackage{unicode-math}
\\setmathfont{${fonts.math}}
\\usepackage${needsArabic ? "[bidi=basic]" : "[english]"}{babel}
${needsArabic ? (profile.direction === "rtl" ? "\\babelprovide[import]{english}\n\\babelprovide[import,main]{arabic}" : "\\babelprovide[import,main]{english}\n\\babelprovide[import]{arabic}") : ""}
${needsArabic ? `\\babelfont[arabic]{rm}{${fonts.arabic}}` : ""}
${needsCjk ? `\\newfontfamily\\cjkfont{${fonts.cjk}}` : ""}
`
      : "\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n";
  const authors = article.authors.map((name) => text(name)).join(", ");
  const affiliations = (article.authorDetails ?? [])
    .filter((author) => author.affiliation)
    .map(
      (author) =>
        `\\thanks{${text(author.name)} is with ${text(author.affiliation ?? "")}.}`,
    )
    .join("");
  // BibTeX values are data, not authored TeX. Escape them before writing fields.
  const entries = article.entries.map((entry) => {
    const mapped: CitationEntry = {
      id: latexKey(entry.id),
      authors: entry.authors.map((author) => text(author)),
    };
    return {
      ...mapped,
      ...(entry.type === undefined ? {} : { type: entry.type }),
      ...(entry.raw && !entry.title && !entry.authors.length && !entry.issued
        ? { title: text(entry.raw) }
        : {}),
      ...Object.fromEntries(
        Object.entries(entry)
          .filter(
            ([key, value]) =>
              key !== "id" &&
              key !== "authors" &&
              key !== "type" &&
              key !== "raw" &&
              typeof value === "string",
          )
          .map(([key, value]) => [key, text(String(value))]),
      ),
    };
  });
  const manuscript = `${needsColor ? "\\PassOptionsToPackage{dvipsnames,svgnames}{xcolor}\n" : ""}${pdfStandard ? `\\DocumentMetadata{lang=${language},pdfstandard=${pdfStandard},${pdfStandard === "ua-1" ? "pdfversion=1.7," : ""}tagging=on,tagging-setup={math/setup={mathml-AF${pdfStandard === "ua-2" ? ",mathml-SE" : ""}}}}\n` : ""}\\documentclass${profile.classOptions ? `[${profile.classOptions}]` : ""}{${profile.className}}
${unicodePreamble}${needsColor ? "\\usepackage{xcolor}\n" : ""}\\usepackage{amsmath,${engine === "pdflatex" && profile.pdfSymbols === true ? "amssymb," : ""}graphicx,listings,tabularx${profile.numericCitationPackage ? ",cite" : ""}}
% flafter keeps floats at or after their source position, so a figure can
% never be hoisted above the abstract region on the first page.
\\usepackage{flafter}
\\usepackage{placeins}
\\usepackage[normalem]{ulem}
\\usepackage{hyperref}
${pdfStandard ? listingsTagging : ""}\\hypersetup{hidelinks}
\\hypersetup{pdftitle={${latexText(article.title ?? "Untitled")}},pdfauthor={${latexText(article.authors.join(", "))}}}
${profile.author ? profile.author(article, text) : `\\title{${text(article.title ?? "Untitled")}}\n\\author{${authors}${affiliations}}`}
\\date{}
${profile.preamble ?? ""}
\\begin{document}
${profile.frontmatter ? profile.frontmatter(abstract.join("\n\n"), article, text) : `\\maketitle${abstract.join("\n\n").trim() ? `\n\\begin{abstract}\n${abstract.join("\n\n")}\n\\end{abstract}` : ""}`}
${profile.keywords?.(article.subjects ?? [], text) ?? ""}
${body.join("\n\n")}
${context.bibliography.length ? "\\FloatBarrier" : ""}
${profile.bibliographyStyle ? (context.bibliography.length ? `${profile.automaticBibliographyStyle ? "" : `\\bibliographystyle{${profile.bibliographyStyle}}\n`}\\bibliography{references}` : "") : context.bibliography.length ? `\\section*{${profile.direction === "rtl" ? text("المراجع") : "References"}}\n${context.bibliography.map((item) => text(item.text)).join("\n\n")}` : ""}
\\end{document}
`;
  return {
    template: profile.id,
    templateVersion: profile.version,
    format: "latex",
    engine,
    ...(pdfStandard ? { pdfStandard } : {}),
    requirements: [
      "amsmath.sty",
      ...(needsColor ? ["xcolor.sty"] : []),
      "flafter.sty",
      "placeins.sty",
      "graphicx.sty",
      "listings.sty",
      "tabularx.sty",
      "ulem.sty",
      "hyperref.sty",
      ...(pdfStandard ? ["tagpdf.sty", "luamml.sty"] : []),
      ...(engine === "lualatex"
        ? ["fontspec.sty", "unicode-math.sty", "lualatex-math.sty", "babel.sty"]
        : []),
      `${profile.className}.cls`,
      ...(profile.bibliographyStyle
        ? [`${profile.bibliographyStyle}.bst`]
        : []),
    ],
    fonts: engine === "lualatex" ? fonts : {},
    files: {
      "placeins.sty": placeins,
      "manuscript.tex": manuscript,
      "references.bib": toBibtex(entries),
      "BUILD.md": `# Rebuild\n\nRequires latexmk, ${engine}, and ${profile.className}.${pdfStandard ? ` LaTeX format >= 2025-11-01 is required for ${pdfStandard} tagging. Compiling does not run PDF/UA validation.` : ""}\n\nRun: latexmk -${engine === "pdflatex" ? "pdf" : "lualatex"} -norc -interaction=nonstopmode -halt-on-error -no-shell-escape manuscript.tex\n`,
    },
    assets,
    diagnostics: [
      ...article.losses,
      ...(pdfStandard
        ? []
        : [
            {
              code: "pdf-ua-unavailable",
              message:
                requested === false
                  ? "PDF tagging was explicitly disabled; this output does not claim PDF/UA conformance."
                  : `PDF/UA tagging is unavailable for ${profile.id} with ${engine}; use a LuaLaTeX article template.`,
            },
          ]),
    ],
  };
}

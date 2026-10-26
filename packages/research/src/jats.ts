import type { ArticleInline, ArticleListItem } from "./article.ts";
import type { ResolvedDocument } from "./resolve.ts";

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function jatsList(
  ordered: boolean,
  items: readonly (readonly ArticleInline[] | ArticleListItem)[],
  take: (inlines: readonly ArticleInline[]) => string,
): string {
  const listItem = (
    item: readonly ArticleInline[] | ArticleListItem,
  ): string => {
    const content = "content" in item ? item.content : item;
    const children = "content" in item ? (item.children ?? []) : [];
    const nested = children
      .map((child) => jatsList(child.ordered, child.items, take))
      .join("");
    return `<list-item><p>${take(content)}</p>${nested}</list-item>`;
  };
  return `<list list-type="${ordered ? "order" : "bullet"}">${items
    .map(listItem)
    .join("")}</list>`;
}

function xmlId(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(value) &&
    !value.startsWith("publisle-id-")
    ? value
    : "publisle-id-" +
        Array.from(new TextEncoder().encode(value), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
}
function inlineJats(
  inlines: readonly ArticleInline[],
  resolved: ResolvedDocument,
  cursor: { index: number },
): string {
  return inlines
    .map((inline) => {
      if (inline.type === "break") return "<break/>";
      if (inline.type === "math")
        return `<inline-formula><tex-math><![CDATA[${inline.value.replaceAll("]]>", "]]]]><![CDATA[>")}]]></tex-math></inline-formula>`;
      if (inline.type === "link")
        return `<ext-link ext-link-type="uri" xlink:href="${xml(inline.url)}">${xml(inline.value)}</ext-link>`;
      if (inline.type === "citation") {
        const text = resolved.citations[cursor.index] ?? "";
        cursor.index += 1;
        const rid = inline.cluster.items
          .map((item) => xmlId(item.id))
          .join(" ");
        return `<xref ref-type="bibr" rid="${xml(rid)}">${xml(text)}</xref>`;
      }
      if (inline.reference) {
        const target = resolved.article.blocks.find(
          (block) => block.label === inline.reference?.target,
        );
        const kind =
          inline.reference.kind === "footnote"
            ? "fn"
            : target?.kind === "figure"
              ? "fig"
              : target?.kind === "table"
                ? "table"
                : target?.kind === "math"
                  ? "disp-formula"
                  : "sec";
        return `<xref ref-type="${kind}" rid="${xmlId(inline.reference.target)}">${xml(inline.value)}</xref>`;
      }
      const value = xml(inline.value);
      if (inline.mark === "emphasis") return `<italic>${value}</italic>`;
      if (inline.mark === "strong") return `<bold>${value}</bold>`;
      if (inline.mark === "code") return `<monospace>${value}</monospace>`;
      if (inline.mark === "strike") return `<strike>${value}</strike>`;
      return value;
    })
    .join("");
}

function publicationType(type: string | undefined): string {
  if (type === "article-journal") return "journal";
  if (type === "book") return "book";
  if (type === "paper-conference") return "confproc";
  return "other";
}

function name(author: string): string {
  const comma = author.indexOf(",");
  const surname = xml((comma === -1 ? author : author.slice(0, comma)).trim());
  const given = comma === -1 ? "" : author.slice(comma + 1).trim();
  return `<name><surname>${surname}</surname>${given.length === 0 ? "" : `<given-names>${xml(given)}</given-names>`}</name>`;
}

/** JATS Archiving 1.3 article XML. It is not a publisher submission bundle. */
export function toJats(resolved: ResolvedDocument): string {
  const cursor = { index: 0 };
  const take = (inlines: readonly ArticleInline[]) =>
    inlineJats(inlines, resolved, cursor);
  const abstract: string[] = [];
  const body: string[] = [];
  const footnotes: string[] = [];
  const sections: number[] = [];
  const closeSections = (level = 0) => {
    while (sections.length && (sections[sections.length - 1] ?? 0) >= level) {
      body.push("</sec>");
      sections.pop();
    }
  };
  for (const block of resolved.article.blocks) {
    const target =
      block.kind !== "footnote" &&
      block.kind !== "bibliography" &&
      block.abstract
        ? abstract
        : body;
    if (block.kind === "heading") {
      if (!block.abstract) {
        closeSections(block.level);
        sections.push(block.level);
        target.push(
          `<sec${block.label ? ` id="${xmlId(block.label)}"` : ""}><title>${take(block.inlines)}</title>`,
        );
      } else abstract.push(`<title>${take(block.inlines)}</title>`);
    } else if (block.kind === "paragraph")
      target.push(`<p>${take(block.inlines)}</p>`);
    else if (block.kind === "list") {
      target.push(jatsList(block.ordered, block.items, take));
    } else if (block.kind === "quote") {
      target.push(
        `<disp-quote>${block.paragraphs.map((paragraph) => `<p>${take(paragraph)}</p>`).join("")}</disp-quote>`,
      );
    } else if (block.kind === "code")
      target.push(`<preformat>${xml(block.value)}</preformat>`);
    else if (block.kind === "math")
      target.push(
        `<disp-formula${block.label ? ` id="${xmlId(block.label)}"` : ""}><tex-math><![CDATA[${block.value.replaceAll("]]>", "]]]]><![CDATA[>")}]]></tex-math></disp-formula>`,
      );
    else if (block.kind === "figure")
      target.push(
        `<fig${block.label ? ` id="${xmlId(block.label)}"` : ""}><caption><p>${take(block.caption)}</p></caption><alt-text>${xml(block.alt)}</alt-text><graphic xlink:href="${xml(block.src)}"/></fig>`,
      );
    else if (block.kind === "table") {
      const caption = block.caption
        ? `<caption><p>${take(block.caption)}</p></caption>`
        : "";
      const rows = block.rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${take(cell)}</td>`).join("")}</tr>`,
        )
        .join("");
      target.push(
        `<table-wrap${block.label ? ` id="${xmlId(block.label)}"` : ""}>${caption}<table>${rows}</table></table-wrap>`,
      );
    } else if (block.kind === "footnote") {
      footnotes.push(
        `<fn id="${xmlId(block.id)}"><p>${block.paragraphs.map((paragraph) => take(paragraph)).join(" ")}</p></fn>`,
      );
    }
  }
  closeSections();
  const entryById = new Map(
    resolved.article.entries.map((entry) => [entry.id, entry]),
  );
  const refs = resolved.bibliography
    .map((item) => {
      const entry = entryById.get(item.id);
      if (
        !entry ||
        (entry.raw && !entry.title && !entry.authors.length && !entry.issued)
      )
        return `<ref id="${xmlId(item.id)}"><mixed-citation>${xml(entry?.raw ?? item.text)}</mixed-citation></ref>`;
      const pages = (entry.page ?? "").split(/--|-|–/u);
      const first = pages[0]?.trim() ?? "";
      const last = pages[1]?.trim();
      return `<ref id="${xmlId(item.id)}"><element-citation publication-type="${publicationType(entry.type)}">${
        entry.authors.length > 0
          ? `<person-group person-group-type="author">${entry.authors.map(name).join("")}</person-group>`
          : ""
      }${entry.title === undefined ? "" : `<article-title>${xml(entry.title)}</article-title>`}${
        entry.containerTitle === undefined
          ? ""
          : `<source>${xml(entry.containerTitle)}</source>`
      }${entry.issued === undefined ? "" : `<year>${xml(entry.issued.slice(0, 4))}</year>`}${
        entry.volume === undefined
          ? ""
          : `<volume>${xml(entry.volume)}</volume>`
      }${entry.issue === undefined ? "" : `<issue>${xml(entry.issue)}</issue>`}${
        first.length === 0 ? "" : `<fpage>${xml(first)}</fpage>`
      }${last === undefined || last.length === 0 ? "" : `<lpage>${xml(last)}</lpage>`}${
        entry.doi === undefined
          ? ""
          : `<pub-id pub-id-type="doi">${xml(entry.doi)}</pub-id>`
      }</element-citation></ref>`;
    })
    .join("");
  const authors = resolved.article.authors
    .map(
      (author) =>
        `<contrib contrib-type="author"><name><surname>${xml(author)}</surname></name></contrib>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<article xmlns:xlink="http://www.w3.org/1999/xlink" article-type="research-article" dtd-version="1.3"${resolved.article.language ? ` xml:lang="${xml(resolved.article.language)}"` : ""}>
<front><article-meta>
<title-group><article-title>${xml(resolved.article.title ?? "Untitled")}</article-title></title-group>
${authors.length === 0 ? "" : `<contrib-group>${authors}</contrib-group>`}
${abstract.length === 0 ? "" : `<abstract>${abstract.join("")}</abstract>`}
</article-meta></front>
<body>${body.join("")}</body>
<back>
${footnotes.length === 0 ? "" : `<fn-group>${footnotes.join("")}</fn-group>`}
<ref-list>${refs}</ref-list>
</back>
</article>
`;
}

export interface JatsPackage {
  readonly files: Readonly<Record<string, string>>;
  readonly assets: readonly {
    readonly source: string;
    readonly destination: string;
  }[];
  readonly diagnostics: ResolvedDocument["losses"];
}
/** Pure article-and-assets package. Node collection validates with the bundled offline DTD. */
export function createJatsPackage(resolved: ResolvedDocument): JatsPackage {
  if (resolved.unresolved.length)
    throw new Error(`Unresolved citations: ${resolved.unresolved.join(", ")}`);
  const assets: { source: string; destination: string }[] = [];
  const blocks = resolved.article.blocks.map((block) => {
    if (block.kind !== "figure") return block;
    if (/^(?:[a-z]+:|\/\/)/iu.test(block.src))
      throw new Error("JATS package requires local figure assets.");
    const extension = /\.([a-z0-9]+)$/iu.exec(block.src)?.[1] ?? "bin";
    const destination = `assets/figure-${String(assets.length + 1)}.${extension}`;
    assets.push({ source: block.src, destination });
    return { ...block, src: destination };
  });
  return {
    files: {
      "article.xml": toJats({
        ...resolved,
        article: { ...resolved.article, blocks },
      }),
    },
    assets,
    diagnostics: resolved.losses,
  };
}

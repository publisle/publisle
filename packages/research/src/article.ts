import { parseBibtex } from "./bibtex.ts";
import { resolveReadable } from "@publisle/schema";
import type { Block, BlockType, Document } from "@publisle/schema";
import type {
  Article,
  ArticleBlock,
  ArticleInline,
  ArticleMark,
  CitationCluster,
  CitationRef,
  CitationEntry,
  ResearchLoss,
} from "@publisle/template-sdk";
export type {
  Article,
  ArticleBlock,
  ArticleInline,
  CitationCluster,
  CitationRef,
  CitationEntry,
  ResearchLoss,
} from "@publisle/template-sdk";
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function pushLoss(losses: ResearchLoss[], code: string, message: string): void {
  if (losses.some((loss) => loss.code === code)) return;
  losses.push({ code, message });
}

export function readEntries(document: Document<Block<BlockType, unknown>>): {
  readonly entries: readonly CitationEntry[];
  readonly losses: readonly ResearchLoss[];
} {
  const entries: CitationEntry[] = [];
  const seen = new Set<string>();
  const losses: ResearchLoss[] = [];
  for (const block of document.blocks) {
    if (block.type !== "publisle:bibliography" || !isRecord(block.data))
      continue;
    const listed = block.data["entries"];
    if (!Array.isArray(listed)) continue;
    for (const original of listed) {
      let entry: unknown = original;
      if (
        isRecord(entry) &&
        typeof entry["raw"] === "string" &&
        !entry["title"] &&
        !entry["authors"] &&
        !entry["issued"] &&
        entry["raw"].trimStart().startsWith("@")
      ) {
        try {
          const normalized = parseBibtex(entry["raw"])[0];
          if (normalized) entry = { ...normalized, ...entry };
        } catch {
          pushLoss(
            losses,
            "opaque-reference-literal",
            "Unparsed bibliography source is preserved literally.",
          );
        }
      }
      if (
        !isRecord(entry) ||
        typeof entry["id"] !== "string" ||
        entry["id"].length === 0
      )
        continue;
      const id = entry["id"];
      if (seen.has(id)) {
        pushLoss(
          losses,
          "duplicate-bibliography-entry",
          `Bibliography id ${id} is repeated. Resolution uses the first entry.`,
        );
        continue;
      }
      seen.add(id);
      const authors = Array.isArray(entry["authors"])
        ? entry["authors"].filter(
            (author): author is string => typeof author === "string",
          )
        : [];
      const type = textOf(entry["type"]);
      const title = textOf(entry["title"]);
      const issued = textOf(entry["issued"]);
      const containerTitle = textOf(entry["containerTitle"]);
      const volume = textOf(entry["volume"]);
      const issue = textOf(entry["issue"]);
      const page = textOf(entry["page"]);
      const publisher = textOf(entry["publisher"]);
      const doi = textOf(entry["doi"]);
      const url = textOf(entry["url"]);
      const raw = textOf(entry["raw"]);
      entries.push({
        id,
        authors,
        ...(type === undefined ? {} : { type }),
        ...(title === undefined ? {} : { title }),
        ...(issued === undefined ? {} : { issued }),
        ...(containerTitle === undefined ? {} : { containerTitle }),
        ...(volume === undefined ? {} : { volume }),
        ...(issue === undefined ? {} : { issue }),
        ...(page === undefined ? {} : { page }),
        ...(publisher === undefined ? {} : { publisher }),
        ...(doi === undefined ? {} : { doi }),
        ...(url === undefined ? {} : { url }),
        ...(raw === undefined ? {} : { raw }),
      });
    }
  }
  return { entries, losses };
}

function plainText(inlines: readonly ArticleInline[]): string {
  return inlines
    .map((inline) =>
      inline.type === "text" || inline.type === "link" ? inline.value : "",
    )
    .join("");
}

function citationCluster(
  value: Record<string, unknown>,
): CitationCluster | undefined {
  const items = value["items"];
  if (!Array.isArray(items)) return undefined;
  const refs: CitationRef[] = [];
  for (const item of items) {
    if (!isRecord(item) || typeof item["id"] !== "string") continue;
    const locator = textOf(item["locator"]);
    const label = textOf(item["label"]);
    refs.push({
      id: item["id"],
      ...(locator === undefined ? {} : { locator }),
      ...(label === undefined ? {} : { label }),
      ...(item["suppressAuthor"] === true ? { suppressAuthor: true } : {}),
    });
  }
  if (refs.length === 0) return undefined;
  const prefix = textOf(value["prefix"]);
  const suffix = textOf(value["suffix"]);
  return {
    items: refs,
    ...(prefix === undefined ? {} : { prefix }),
    ...(suffix === undefined ? {} : { suffix }),
  };
}

/** Nested emphasis/strong pairs map onto one combined font role. */
function combinedMark(outer: ArticleMark, inner: ArticleMark): ArticleMark {
  const marks = new Set([outer, inner]);
  if (marks.has("strong") && marks.has("emphasis")) return "bold-italic";
  return inner;
}

function inlineList(value: unknown, losses: ResearchLoss[]): ArticleInline[] {
  if (!Array.isArray(value)) return [];
  const result: ArticleInline[] = [];
  for (const node of value) {
    if (!isRecord(node) || typeof node["type"] !== "string") continue;
    const type = node["type"];
    if (type === "text" && typeof node["value"] === "string") {
      const direction = node["direction"];
      result.push({
        type: "text",
        value: node["value"],
        ...(direction === "ltr" || direction === "rtl" || direction === "auto"
          ? { direction }
          : {}),
      });
    } else if (
      (type === "emphasis" || type === "strong" || type === "strikethrough") &&
      Array.isArray(node["children"])
    ) {
      const mark = type === "strikethrough" ? "strike" : type;
      for (const child of inlineList(node["children"], losses)) {
        if (child.type === "text") {
          result.push({
            ...child,
            mark:
              child.mark && child.mark !== mark
                ? combinedMark(child.mark, mark)
                : mark,
          });
        } else result.push(child);
      }
    } else if (type === "inlineCode" && typeof node["value"] === "string") {
      result.push({ type: "text", value: node["value"], mark: "code" });
    } else if (type === "inlineMath" && typeof node["value"] === "string") {
      result.push({ type: "math", value: node["value"] });
    } else if (type === "link" && typeof node["url"] === "string") {
      const label = plainText(inlineList(node["children"], losses));
      result.push({
        type: "link",
        url: node["url"],
        value: label || node["url"],
      });
    } else if (type === "inlineImage") {
      result.push({
        type: "text",
        value: typeof node["alt"] === "string" ? node["alt"] : "",
      });
    } else if (type === "hardBreak" || type === "softBreak") {
      result.push({ type: "break" });
    } else if (type === "citationReference") {
      const cluster = citationCluster(node);
      if (cluster) result.push({ type: "citation", cluster });
    } else if (
      type === "footnoteReference" &&
      typeof node["identifier"] === "string"
    ) {
      result.push({
        type: "text",
        value: node["identifier"],
        mark: "code",
        reference: { kind: "footnote", target: node["identifier"] },
      });
    } else if (type === "crossReference") {
      const label = plainText(inlineList(node["children"], losses));
      result.push({
        type: "text",
        reference: { kind: "cross", target: textOf(node["target"]) ?? "" },
        value:
          label || (typeof node["target"] === "string" ? node["target"] : ""),
      });
    } else if (type === "rawHtml" && typeof node["value"] === "string") {
      pushLoss(
        losses,
        "raw-html-uninterpreted",
        "Raw HTML is kept as text. Tags are not interpreted.",
      );
      result.push({
        type: "text",
        value: node["value"].replace(/<[^>]*>/gu, ""),
      });
    }
  }
  return result;
}

function flowParagraphs(
  value: unknown,
  losses: ResearchLoss[],
): ArticleInline[][] {
  if (!Array.isArray(value)) return [];
  const paragraphs: ArticleInline[][] = [];
  for (const node of value) {
    if (!isRecord(node)) continue;
    if (node["type"] === "paragraph")
      paragraphs.push(inlineList(node["content"], losses));
    else if (node["type"] === "list") {
      pushLoss(
        losses,
        "nested-list-flattened",
        "A nested list is written as following paragraphs.",
      );
      for (const item of Array.isArray(node["items"]) ? node["items"] : []) {
        if (!isRecord(item)) continue;
        paragraphs.push(...flowParagraphs(item["children"], losses));
      }
    } else {
      paragraphs.push(...flowParagraphs(node["children"], losses));
    }
  }
  return paragraphs;
}

export function projectArticle(
  document: Document<Block<BlockType, unknown>>,
): Article {
  const losses: ResearchLoss[] = [];
  const read = readEntries(document);
  losses.push(...read.losses);
  const blocks: ArticleBlock[] = [];
  // An abstract is prose-only. The first non-paragraph block ends it, so a
  // figure or table after the abstract heading can never join the abstract
  // and float above it on the first page.
  let abstract = false;
  const authors = (document.metadata?.authors ?? []).map(
    (author) => author.name,
  );
  for (const block of document.blocks) {
    const data = isRecord(block.data) ? block.data : {};
    const labeled =
      typeof data["label"] === "string" ? { label: data["label"] } : {};
    if (block.type === "publisle:heading") {
      const role = data["role"];
      abstract = role === "abstract";
      const level = typeof data["level"] === "number" ? data["level"] : 1;
      blocks.push({
        kind: "heading",
        ...labeled,
        level,
        inlines: inlineList(data["content"], losses),
        abstract,
      });
      continue;
    }
    if (block.type !== "publisle:paragraph") abstract = false;
    if (block.type === "publisle:paragraph") {
      blocks.push({
        kind: "paragraph",
        inlines: inlineList(data["content"], losses),
        abstract,
      });
      continue;
    }
    if (block.type === "publisle:list" && Array.isArray(data["items"])) {
      blocks.push({
        kind: "list",
        ordered: data["ordered"] === true,
        items: data["items"].map((item: unknown) => {
          const children = isRecord(item) ? item["children"] : [];
          return flowParagraphs(children, losses).flat();
        }),
        abstract,
      });
      continue;
    }
    if (block.type === "publisle:quote") {
      blocks.push({
        kind: "quote",
        paragraphs: flowParagraphs(data["children"], losses),
        abstract,
      });
      continue;
    }
    if (block.type === "publisle:code" && typeof data["value"] === "string") {
      blocks.push({ kind: "code", value: data["value"], abstract });
      continue;
    }
    if (block.type === "publisle:math" && typeof data["value"] === "string") {
      blocks.push({
        kind: "math",
        ...labeled,
        value: data["value"],
        display: data["display"] === true,
        abstract,
      });
      continue;
    }
    if (block.type === "publisle:table" && Array.isArray(data["rows"])) {
      blocks.push({
        kind: "table",
        ...labeled,
        caption: flowParagraphs(data["caption"], losses).flat(),
        headerRows:
          typeof data["headerRows"] === "number" ? data["headerRows"] : 1,
        rows: data["rows"].map((row: unknown) =>
          Array.isArray(row) ? row.map((cell) => inlineList(cell, losses)) : [],
        ),
        abstract,
      });
      continue;
    }
    if (
      block.type === "publisle:footnote" &&
      typeof data["identifier"] === "string"
    ) {
      blocks.push({
        kind: "footnote",
        id: data["identifier"],
        paragraphs: flowParagraphs(data["children"], losses),
      });
      continue;
    }
    if (block.type === "publisle:bibliography") {
      blocks.push({ kind: "bibliography" });
      continue;
    }
    if (block.type === "publisle:figure") {
      blocks.push({
        kind: "figure",
        src: textOf(data["src"]) ?? "",
        alt: textOf(data["alt"]) ?? "",
        caption: flowParagraphs(data["caption"], losses).flat(),
        abstract,
        ...labeled,
      });
      continue;
    }
    if (block.type === "publisle:callout") {
      for (const paragraph of flowParagraphs(data["children"], losses)) {
        blocks.push({ kind: "paragraph", inlines: paragraph, abstract });
      }
      continue;
    }
    if (
      block.type === "publisle:embed" ||
      block.type === "publisle:diagram" ||
      block.type === "publisle:raw-html"
    ) {
      pushLoss(
        losses,
        "research-block-reduced",
        "Embeds, diagrams, and raw HTML contribute their readable text. Their behavior is not executed.",
      );
      const fallback = flowParagraphs(data["fallback"], losses).flat();
      const alt = textOf(data["alt"]) ?? textOf(data["title"]);
      const source = textOf(data["value"]);
      // One readable reduction: the authored fallback already describes the
      // block, so appending the alternative text would repeat it. Strip tags
      // from raw HTML only when nothing authored describes it.
      const inlines: ArticleInline[] = fallback.length
        ? [...fallback]
        : alt
          ? [{ type: "text", value: alt }]
          : [];
      if (source && !inlines.length)
        inlines.push({
          type: "text",
          value: source.replace(/<[^>]*>/gu, ""),
        });
      blocks.push({
        kind: "paragraph",
        inlines,
        abstract,
      });
    } else {
      pushLoss(
        losses,
        "research-block-fallback",
        `Unsupported research block ${block.type} uses readable fallback.`,
      );
      const readable = block.readable
        ? resolveReadable(block.readable, block.data)
        : undefined;
      const content =
        readable ?? (isRecord(data["content"]) ? data["content"] : {});
      const paragraphs = flowParagraphs(
        data["fallback"] ?? content.fallback,
        losses,
      );
      if (content.title) paragraphs.unshift(inlineList(content.title, losses));
      for (const paragraph of paragraphs)
        blocks.push({ kind: "paragraph", inlines: paragraph, abstract });
    }
  }
  const title = document.metadata?.title;
  return {
    authors,
    authorDetails: document.metadata?.authors ?? [],
    subjects: document.metadata?.subjects ?? [],
    ...(document.metadata?.language === undefined
      ? {}
      : { language: document.metadata.language }),
    ...(document.metadata?.direction === undefined
      ? {}
      : { direction: document.metadata.direction }),
    blocks,
    entries: read.entries,
    losses,
    ...(title === undefined ? {} : { title }),
  };
}

export function citationClusters(article: Article): CitationCluster[] {
  const clusters: CitationCluster[] = [];
  const notes = new Map(
    article.blocks
      .filter((block) => block.kind === "footnote")
      .map((block) => [block.id, block.paragraphs]),
  );
  const visited = new Set<string>();
  const visit = (inlines: readonly ArticleInline[]) => {
    for (const inline of inlines) {
      if (inline.type === "citation") clusters.push(inline.cluster);
      if (
        inline.type === "text" &&
        inline.reference?.kind === "footnote" &&
        !visited.has(inline.reference.target)
      ) {
        visited.add(inline.reference.target);
        for (const paragraph of notes.get(inline.reference.target) ?? [])
          visit(paragraph);
      }
    }
  };
  for (const block of article.blocks) {
    if (block.kind === "heading" || block.kind === "paragraph")
      visit(block.inlines);
    else if (block.kind === "list") for (const item of block.items) visit(item);
    else if (block.kind === "quote")
      for (const paragraph of block.paragraphs) visit(paragraph);
    else if (block.kind === "table") {
      if (block.caption) visit(block.caption);
      for (const row of block.rows) for (const cell of row) visit(cell);
    } else if (block.kind === "figure") visit(block.caption);
  }
  return clusters;
}

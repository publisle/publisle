import {
  isPlainObject,
  type Block,
  type BlockType,
  type Document,
} from "@publisle/schema";
import { citationClusters, projectArticle } from "./article.ts";
import { resolveDocument, type ResolvedDocument } from "./resolve.ts";
import type { ArticleBlock, ArticleInline } from "./article.ts";

export const NATIVE_PDF_INPUT_VERSION = 1 as const;
export const NATIVE_PDF_TEMPLATES = [
  "article",
  "article-arabic",
  "ieee-journal",
  "acm-journal",
  "springer-journal",
  "elsevier-numeric",
  "elsevier-author-date",
] as const;
export type NativePdfTemplate = (typeof NATIVE_PDF_TEMPLATES)[number];
export interface NativeFont {
  readonly path: string;
  readonly role:
    "regular" | "bold" | "italic" | "bold-italic" | "mono" | "fallback";
  readonly index?: number;
}
export interface NativePdfInput {
  readonly schemaVersion: typeof NATIVE_PDF_INPUT_VERSION;
  readonly template: NativePdfTemplate;
  readonly templateVersion: string;
  readonly pdfStandard: "ua-1" | "ua-2" | null;
  readonly article: ResolvedDocument["article"] & { readonly title: string };
  readonly citations: readonly string[];
  readonly bibliography: ResolvedDocument["bibliography"];
  readonly assets: readonly {
    readonly source: string;
    readonly path: string;
  }[];
  readonly fonts: readonly NativeFont[];
  readonly templateData: { readonly country?: string };
}
export interface NativePdfOptions {
  readonly template?: NativePdfTemplate;
  readonly style?: string;
  readonly pdfUa?: "ua-1" | "ua-2" | false;
  readonly fonts: readonly NativeFont[];
  readonly assets?: NativePdfInput["assets"];
  readonly data?: { readonly country?: string };
}
export interface NativePdfPackage {
  readonly input: NativePdfInput;
  /** Maps bounded compiler block indices back to authored source IDs. */
  readonly blockIds: readonly string[];
  readonly diagnostics: ResolvedDocument["losses"];
}

/** Pure lowering shared by the website worker and Research CLI. No filesystem or network access. */
export function createNativePdfPackage(
  document: Document<Block<BlockType, unknown>>,
  options: NativePdfOptions,
): NativePdfPackage {
  const template = options.template ?? "article";
  if (!NATIVE_PDF_TEMPLATES.includes(template))
    throw new Error(`Unsupported native PDF template: ${template}`);
  const resolved = resolveDocument(
    document,
    options.style ??
      (template === "elsevier-author-date" ? "author-date" : "numeric"),
  );
  if (resolved.unresolved.length)
    throw new Error(`Unresolved citations: ${resolved.unresolved.join(", ")}`);
  if (
    ["ieee-journal", "springer-journal"].includes(template) &&
    resolved.form !== "numeric"
  )
    throw new Error("This journal profile requires numeric citations.");
  if (template === "elsevier-author-date" && resolved.form !== "author-date")
    throw new Error("This journal profile requires author-date citations.");
  if (
    options.data !== undefined &&
    (!isPlainObject(options.data) ||
      Object.keys(options.data).some((key) => key !== "country") ||
      (options.data.country !== undefined &&
        (typeof options.data.country !== "string" ||
          options.data.country.length > 100)))
  )
    throw new Error("Unsupported native template metadata.");
  if (
    template === "acm-journal" &&
    resolved.article.authorDetails?.some((author) => author.affiliation) &&
    !options.data?.country?.trim()
  )
    throw new Error("ACM affiliations require template data: country.");
  if (!resolved.article.title?.trim() || !resolved.article.authors.length)
    throw new Error("PDF export requires a title and at least one author.");
  if (options.fonts.length === 0 || options.fonts.length > 16)
    throw new Error("Native PDF export requires one to sixteen pinned fonts.");
  const article = structuredClone(resolved.article);
  // Markdown leaves unspecified column alignments empty. JSON arrays encode
  // those entries as null, while the native schema requires explicit values.
  for (const block of article.blocks) {
    if (block.kind === "table" && block.align)
      Object.assign(block, {
        align: block.align.map((alignment) => alignment ?? "left"),
      });
  }
  // CSL resolves cited footnotes at their first reference, rather than at the
  // definition's physical position. Bind results before the native layout runs.
  const notes = new Map(
    article.blocks
      .filter((block) => block.kind === "footnote")
      .map((block) => [block.id, block]),
  );
  const visited = new Set<string>();
  let cursor = 0;
  const bind = (inlines: readonly ArticleInline[]): void => {
    for (const inline of inlines) {
      if (inline.type === "citation") {
        const value = resolved.citations[cursor++];
        if (value === undefined)
          throw new Error(
            "Resolved citation count does not match the article.",
          );
        Object.assign(inline, { text: value });
      } else if (
        inline.type === "text" &&
        inline.reference?.kind === "footnote" &&
        !visited.has(inline.reference.target)
      ) {
        visited.add(inline.reference.target);
        notes.get(inline.reference.target)?.paragraphs.forEach(bind);
      }
    }
  };
  for (const block of article.blocks) visitInlines(block, bind);
  if (cursor !== resolved.citations.length)
    throw new Error("Resolved citation count does not match the article.");
  // Each projection may emit multiple printable blocks (for example callouts).
  const blockIds = document.blocks.flatMap((block) =>
    projectArticle({ ...document, blocks: [block] }).blocks.map(() => block.id),
  );
  if (blockIds.length !== article.blocks.length)
    throw new Error("Native projection source mapping is inconsistent.");
  const clusters = citationClusters(resolved.article);
  if (clusters.length !== resolved.citations.length)
    throw new Error("Resolved citation clusters are inconsistent.");
  return {
    input: {
      schemaVersion: NATIVE_PDF_INPUT_VERSION,
      template,
      templateVersion: "0.1.0-experimental",
      pdfStandard: options.pdfUa === false ? null : (options.pdfUa ?? "ua-2"),
      article: { ...article, title: resolved.article.title },
      citations: resolved.citations,
      bibliography: resolved.bibliography,
      assets: options.assets ?? [],
      fonts: options.fonts,
      templateData: options.data ?? {},
    },
    blockIds,
    diagnostics: resolved.losses,
  };
}

function visitInlines(
  block: ArticleBlock,
  visit: (inlines: readonly ArticleInline[]) => void,
): void {
  switch (block.kind) {
    case "heading":
    case "paragraph":
      visit(block.inlines);
      break;
    case "list":
      block.items.forEach((item) => {
        if ("content" in item) {
          visit(item.content);
          for (const child of item.children ?? [])
            for (const nested of child.items) {
              if ("content" in nested) visit(nested.content);
              else visit(nested);
            }
        } else {
          visit(item);
        }
      });
      break;
    case "quote":
      block.paragraphs.forEach(visit);
      break;
    case "figure":
      visit(block.caption);
      break;
    case "table":
      if (block.caption) visit(block.caption);
      block.rows.forEach((row) => {
        row.forEach(visit);
      });
      break;
    default:
      break;
  }
}

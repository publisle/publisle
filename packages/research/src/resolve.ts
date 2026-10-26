import type { Block, BlockType, Document } from "@publisle/schema";
import {
  citationClusters,
  projectArticle,
  type ArticleInline,
  type Article,
  type ResearchLoss,
} from "./article.ts";
import {
  builtinCsl,
  formatCitations,
  citationForm,
  parseCslStyle,
  type CitationForm,
  type FormattedResearch,
  type CslOptions,
} from "./csl.ts";

export interface ResolvedDocument extends FormattedResearch {
  readonly article: Article;
  readonly losses: readonly ResearchLoss[];
}

export function resolveDocument(
  document: Document<Block<BlockType, unknown>>,
  style = "numeric",
  options: CslOptions = {},
): ResolvedDocument {
  const article = projectArticle(document);
  const parsed =
    style === "numeric" || style === "author-date"
      ? builtinCsl(style)
      : parseCslStyle(style);
  const formatted = formatCitations(
    article.entries,
    citationClusters(article),
    parsed,
    {
      ...options,
      ...(options.noteIndices === undefined && citationForm(parsed) === "note"
        ? { noteIndices: citationNoteIndices(article) }
        : {}),
    },
  );
  return {
    ...formatted,
    article,
    losses: [...article.losses, ...formatted.losses],
  };
}

export type { CitationForm };

function citationNoteIndices(article: Article): number[] {
  const result: number[] = [];
  let number = 0;
  const notes = new Map(
    article.blocks
      .filter((block) => block.kind === "footnote")
      .map((block) => [block.id, block.paragraphs]),
  );
  const visited = new Set<string>();
  const visit = (inlines: readonly ArticleInline[], note?: number) => {
    for (const inline of inlines) {
      if (inline.type === "citation") result.push(note ?? ++number);
      else if (
        inline.type === "text" &&
        inline.reference?.kind === "footnote" &&
        !visited.has(inline.reference.target)
      ) {
        visited.add(inline.reference.target);
        const next = ++number;
        for (const paragraph of notes.get(inline.reference.target) ?? [])
          visit(paragraph, next);
      }
    }
  };
  for (const block of article.blocks) {
    if (block.kind === "heading" || block.kind === "paragraph")
      visit(block.inlines);
    else if (block.kind === "quote")
      for (const paragraph of block.paragraphs) visit(paragraph);
    else if (block.kind === "list")
      for (const item of block.items) {
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
      }
    else if (block.kind === "figure") visit(block.caption);
    else if (block.kind === "table") {
      if (block.caption) visit(block.caption);
      for (const row of block.rows) for (const cell of row) visit(cell);
    }
  }
  return result;
}

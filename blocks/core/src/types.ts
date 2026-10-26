export interface CitationItem {
  readonly id: string;
  readonly locator?: string;
  readonly label?: string;
  readonly suppressAuthor?: boolean;
}

export type WritingDirection = "ltr" | "rtl" | "auto";

export type InlineNode =
  | {
      readonly type: "text";
      readonly value: string;
      readonly direction?: WritingDirection;
    }
  | {
      readonly type: "emphasis" | "strong" | "strikethrough";
      readonly children: readonly InlineNode[];
    }
  | { readonly type: "inlineCode" | "inlineMath"; readonly value: string }
  | {
      readonly type: "link";
      readonly url: string;
      readonly title?: string;
      readonly children: readonly InlineNode[];
    }
  | {
      readonly type: "inlineImage";
      readonly url: string;
      readonly alt: string;
      readonly title?: string;
    }
  | { readonly type: "hardBreak" | "softBreak" }
  | { readonly type: "footnoteReference"; readonly identifier: string }
  | {
      readonly type: "citationReference";
      readonly items: readonly CitationItem[];
      readonly prefix?: string;
      readonly suffix?: string;
    }
  | {
      readonly type: "crossReference";
      readonly target: string;
      readonly children?: readonly InlineNode[];
    }
  | { readonly type: "rawHtml"; readonly value: string };

export type FlowNode =
  | { readonly type: "paragraph"; readonly content: readonly InlineNode[] }
  | {
      readonly type: "heading";
      readonly level: number;
      readonly content: readonly InlineNode[];
    }
  | { readonly type: "quote"; readonly children: readonly FlowNode[] }
  | {
      readonly type: "list";
      readonly ordered: boolean;
      readonly start?: number;
      readonly items: readonly ListItemData[];
    }
  | {
      readonly type: "code";
      readonly value: string;
      readonly language?: string;
      readonly meta?: string;
    }
  | { readonly type: "divider" }
  | { readonly type: "rawHtml"; readonly value: string };

export interface ParagraphData {
  readonly content: readonly InlineNode[];
}
export interface HeadingData {
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly content: readonly InlineNode[];
  readonly label?: string;
  /** Informational section role. It does not impose a paper template. */
  readonly role?: "abstract" | "section";
}
export type ListItemData =
  | { readonly type: "listItem"; readonly children: readonly FlowNode[] }
  | {
      readonly type: "taskListItem";
      readonly checked: boolean;
      readonly children: readonly FlowNode[];
    };
export interface ListData {
  readonly ordered: boolean;
  readonly start?: number;
  readonly items: readonly ListItemData[];
}
export interface QuoteData {
  readonly children: readonly FlowNode[];
}
export interface CodeData {
  readonly value: string;
  readonly language?: string;
  readonly meta?: string;
}
export interface MathData {
  readonly value: string;
  readonly display: boolean;
  readonly label?: string;
}
export interface DownloadableResource {
  readonly src: string;
  readonly mediaType?: string;
  readonly filename?: string;
}
export interface FigureData {
  readonly src: string;
  /** Omitted means undescribed; an explicit empty string marks a decorative image. */
  readonly alt?: string;
  /**
   * Alternative renditions of the same figure, keyed by variant name (for
   * example "dark"). Hosts decide which variant their active theme consumes;
   * hosts without a mapping keep the base rendition.
   */
  readonly variants?: Readonly<Record<string, string>>;
  readonly title?: string;
  readonly label?: string;
  readonly caption?: readonly FlowNode[];
  readonly credit?: readonly InlineNode[];
  readonly original?: DownloadableResource;
}
export interface TableData {
  readonly align: readonly ("left" | "right" | "center" | null)[];
  readonly rows: readonly (readonly (readonly InlineNode[])[])[];
  readonly label?: string;
  readonly caption?: readonly FlowNode[];
  /** Leading rows that label the columns. Omitted leaves the host convention unchanged. */
  readonly headerRows?: number;
}

export interface BibliographyEntry {
  readonly id: string;
  readonly type?: string;
  readonly title?: string;
  readonly authors?: readonly string[];
  readonly issued?: string;
  readonly containerTitle?: string;
  readonly volume?: string;
  readonly issue?: string;
  readonly page?: string;
  readonly publisher?: string;
  readonly edition?: string;
  readonly doi?: string;
  readonly url?: string;
  /** Opaque source kept exactly. Structured fields do not rewrite it. */
  readonly raw?: string;
}

export interface BibliographyData {
  readonly entries: readonly BibliographyEntry[];
}
export interface EmbedData {
  readonly provider: string;
  readonly resourceId: string;
  readonly title: string;
  readonly aspectRatio: { readonly width: number; readonly height: number };
  readonly caption?: readonly FlowNode[];
  readonly fallback?: readonly FlowNode[];
}
export type DiagramEngine =
  "mermaid" | "graphviz" | "wavedrom" | "plantuml" | `${string}:${string}`;
export interface DiagramData {
  readonly engine: DiagramEngine;
  readonly source: string;
  readonly alt: string;
  readonly label?: string;
  readonly caption?: readonly FlowNode[];
  readonly fallback?: readonly FlowNode[];
  readonly printFallback?: DownloadableResource;
}
export interface CalloutData {
  readonly variant: string;
  readonly title?: string;
  readonly children: readonly FlowNode[];
}
export interface FootnoteData {
  readonly identifier: string;
  readonly children: readonly FlowNode[];
}
export interface RawHtmlData {
  readonly value: string;
  readonly inline: boolean;
}

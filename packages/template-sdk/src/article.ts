import type { Author, PublicationMetadata } from "@publisle/schema";

type WritingDirection = NonNullable<PublicationMetadata["direction"]>;

export interface ResearchLoss {
  readonly code: string;
  readonly message: string;
}

export interface CitationRef {
  readonly id: string;
  readonly locator?: string;
  readonly label?: string;
  readonly suppressAuthor?: boolean;
}

export interface CitationCluster {
  readonly items: readonly CitationRef[];
  readonly prefix?: string;
  readonly suffix?: string;
}

export type ArticleMark =
  "emphasis" | "strong" | "code" | "strike" | "bold-italic";
export type ArticleInline =
  | {
      readonly type: "text";
      readonly value: string;
      readonly mark?: ArticleMark;
      readonly direction?: WritingDirection;
      readonly reference?: {
        readonly kind: "footnote" | "cross";
        readonly target: string;
      };
    }
  | { readonly type: "math"; readonly value: string }
  | { readonly type: "link"; readonly url: string; readonly value: string }
  | { readonly type: "citation"; readonly cluster: CitationCluster }
  | { readonly type: "break" };

export interface CitationEntry {
  readonly id: string;
  readonly type?: string;
  readonly title?: string;
  readonly authors: readonly string[];
  readonly issued?: string;
  readonly containerTitle?: string;
  readonly volume?: string;
  readonly issue?: string;
  readonly page?: string;
  readonly publisher?: string;
  readonly doi?: string;
  readonly url?: string;
  readonly raw?: string;
}

export type ArticleBlock = (
  | {
      readonly kind: "heading";
      readonly level: number;
      readonly inlines: readonly ArticleInline[];
      readonly abstract: boolean;
    }
  | {
      readonly kind: "paragraph";
      readonly inlines: readonly ArticleInline[];
      readonly abstract: boolean;
    }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly items: readonly (readonly ArticleInline[])[];
      readonly abstract: boolean;
    }
  | {
      readonly kind: "quote";
      readonly paragraphs: readonly (readonly ArticleInline[])[];
      readonly abstract: boolean;
    }
  | {
      readonly kind: "code";
      readonly value: string;
      readonly abstract: boolean;
    }
  | {
      readonly kind: "math";
      readonly value: string;
      readonly display: boolean;
      readonly abstract: boolean;
    }
  | {
      readonly kind: "table";
      readonly caption?: readonly ArticleInline[];
      readonly headerRows?: number;
      readonly rows: readonly (readonly (readonly ArticleInline[])[])[];
      readonly abstract: boolean;
    }
  | {
      readonly kind: "footnote";
      readonly id: string;
      readonly paragraphs: readonly (readonly ArticleInline[])[];
    }
  | {
      readonly kind: "figure";
      readonly src: string;
      readonly alt: string;
      readonly caption: readonly ArticleInline[];
      readonly abstract: boolean;
    }
  | { readonly kind: "bibliography" }
) & { readonly label?: string };

export interface Article {
  readonly title?: string;
  readonly authors: readonly string[];
  readonly authorDetails?: readonly Author[];
  readonly subjects?: readonly string[];
  readonly language?: string;
  readonly direction?: WritingDirection;
  readonly blocks: readonly ArticleBlock[];
  readonly entries: readonly CitationEntry[];
  readonly losses: readonly ResearchLoss[];
}

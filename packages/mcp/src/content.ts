import { defaultData } from "@publisle/playground/core";
import {
  createBlock,
  document as buildDocument,
  type Document,
} from "@publisle/schema";
import { blockCatalog } from "./tools.ts";
import type { JsonObject } from "./types.ts";

function text(value: string) {
  return { type: "text", value };
}

/** A small, valid article used as the sample resource and by the demo. */
export function sampleDocument(): Document {
  const blocks = [
    createBlock({
      id: "6f4d0f6e-8f0a-4c2e-9a53-1d3f4b2a7c01" as never,
      type: "publisle:heading",
      data: { level: 1, content: [text("Notes on the Fourier transform")] },
    }),
    createBlock({
      id: "6f4d0f6e-8f0a-4c2e-9a53-1d3f4b2a7c02" as never,
      type: "publisle:paragraph",
      data: {
        content: [
          text(
            "A periodic signal is a sum of sines. The transform recovers the amplitude of each one.",
          ),
        ],
      },
    }),
    createBlock({
      id: "6f4d0f6e-8f0a-4c2e-9a53-1d3f4b2a7c03" as never,
      type: "publisle:math",
      data: { value: "X(f)=\\int x(t)e^{-2\\pi i f t}\\,dt", display: true },
    }),
    createBlock({
      id: "6f4d0f6e-8f0a-4c2e-9a53-1d3f4b2a7c04" as never,
      type: "publisle:list",
      data: defaultData("publisle:list"),
    }),
  ];
  return buildDocument({
    blocks,
    metadata: {
      title: "Notes on the Fourier transform",
      language: "en",
      authors: [{ name: "Ada Lovelace" }],
    },
  }) as never;
}

export interface ResourceEntry {
  readonly uri: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly mimeType: string;
  readonly read: () => string;
}

export const RESOURCES: readonly ResourceEntry[] = [
  {
    uri: "publisle://blocks",
    name: "blocks",
    title: "Block catalog",
    description: "Every block type with its default data.",
    mimeType: "application/json",
    read: () => JSON.stringify({ blocks: blockCatalog() }),
  },
  {
    uri: "publisle://examples/sample",
    name: "sample",
    title: "Sample document",
    description: "A small valid article to start from.",
    mimeType: "application/json",
    read: () => JSON.stringify(sampleDocument()),
  },
];

export interface PromptDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly arguments: readonly {
    readonly name: string;
    readonly description: string;
    readonly required: boolean;
  }[];
}

export const PROMPTS: readonly PromptDefinition[] = [
  {
    name: "draft_article",
    title: "Draft an article",
    description:
      "Draft a short article as a Publisle document, validate it and export a PDF.",
    arguments: [
      {
        name: "topic",
        description: "What the article is about.",
        required: true,
      },
    ],
  },
];

export function promptMessages(
  name: string,
  args: JsonObject,
): readonly JsonObject[] | undefined {
  if (name !== "draft_article") return undefined;
  const topic =
    typeof args["topic"] === "string" && args["topic"].length > 0
      ? args["topic"].slice(0, 200)
      : "a topic of your choice";
  return [
    {
      role: "user",
      content: {
        type: "text",
        text: [
          `Write a short article about ${topic} using the Publisle tools.`,
          "1. Call new_document with a title, authors and language.",
          "2. Call list_blocks, then add headings, paragraphs and any math or tables with add_block and update_block.",
          "3. Call validate and fix every error diagnostic.",
          "4. Call render_html to check the result, then compile_pdf to export it.",
        ].join("\n"),
      },
    },
  ];
}

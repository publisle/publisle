import { describe, expect, it } from "vitest";
import { document, createBlock, parseIsoDateTime } from "@publisle/schema";
import type { ArticleInline } from "@publisle/template-sdk";
import { projectArticle } from "../src/article.ts";

const nestedListDocument = () =>
  document({
    metadata: {
      title: "Native lists",
      language: "en",
      authors: [{ name: "Test Author" }],
      publishedAt: parseIsoDateTime("2026-10-25T12:00:00Z"),
    },
    blocks: [
      createBlock({
        type: "publisle:list",
        data: {
          ordered: true,
          start: 3,
          items: [
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  content: [{ type: "text", value: "third" }],
                },
              ],
            },
            {
              type: "listItem",
              children: [
                {
                  type: "paragraph",
                  content: [{ type: "text", value: "fourth" }],
                },
                {
                  type: "list",
                  ordered: false,
                  items: [
                    {
                      type: "listItem",
                      children: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", value: "nested" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }),
      createBlock({
        type: "publisle:code",
        data: { value: "const x = 1;", language: "typescript" },
      }),
      createBlock({
        type: "publisle:table",
        data: {
          align: ["left", "right"],
          rows: [
            [[{ type: "text", value: "a" }], [{ type: "text", value: "b" }]],
          ],
        },
      }),
    ],
  });

describe("native list/table/code projection", () => {
  it("carries start ordinals, nesting, language, alignment and dates", () => {
    const article = projectArticle(nestedListDocument());
    expect(article.date).toBe("2026-10-25T12:00:00Z");
    const list = article.blocks.find((block) => block.kind === "list");
    expect(list).toBeTruthy();
    if (list?.kind !== "list") throw new Error("unreachable");
    expect(list.ordered).toBe(true);
    expect(list.start).toBe(3);
    expect(list.items).toHaveLength(2);
    const first = list.items[0];
    const second = list.items[1];
    // Items without nested children project flat content.
    if (!first || !Array.isArray(first))
      throw new Error("expected flat first item");
    expect(
      first.map((inline: ArticleInline) =>
        "value" in inline ? inline.value : "",
      ),
    ).toContain("third");
    // The second item carries nested children with no flatten loss.
    if (!second || Array.isArray(second) || !("content" in second))
      throw new Error("expected structured second item");
    expect(
      article.losses.some(({ code }) => code === "nested-list-flattened"),
    ).toBe(false);
    const nested = second.children ?? [];
    expect(nested).toHaveLength(1);
    expect(nested[0]?.ordered).toBe(false);
    const nestedItem = nested[0]?.items[0];
    if (!nestedItem || !Array.isArray(nestedItem))
      throw new Error("expected flat nested item");
    expect(
      nestedItem.map((inline: ArticleInline) =>
        "value" in inline ? inline.value : "",
      ),
    ).toContain("nested");

    const code = article.blocks.find((block) => block.kind === "code");
    expect(code?.kind === "code" && code.language).toBe("typescript");

    const table = article.blocks.find((block) => block.kind === "table");
    expect(table?.kind === "table" && table.align).toEqual(["left", "right"]);
  });
});

import { describe, expect, it } from "vitest";
import { bibliographyDefinition } from "@publisle/blocks-core";
import { createBlock, document } from "@publisle/schema";
import type { CitationEntry } from "@publisle/template-sdk";
import { parseBibtex, toBibtex, toCslJson } from "../src/bibtex.ts";
import { builtinCsl, formatCitations } from "../src/csl.ts";
import { createNativePdfPackage } from "../src/native.ts";

const entries: readonly CitationEntry[] = [
  {
    id: "journal",
    type: "article-journal",
    authors: ["Doe, Jane"],
    issued: "2020",
    title: "Journal result",
    containerTitle: "Journal of Tests",
    volume: "12",
    issue: "3",
    page: "41-52",
    doi: "10.1000/journal",
    url: "https://example.org/journal",
  },
  {
    id: "book",
    type: "book",
    authors: ["Knuth, Donald"],
    issued: "1997",
    title: "The Art of Computer Programming",
    volume: "1",
    edition: "3",
    publisher: "Addison-Wesley",
    url: "https://example.org/book",
  },
  {
    id: "chapter",
    type: "chapter",
    authors: ["Roe, Richard"],
    issued: "2021",
    title: "A chapter",
    containerTitle: "Collected Tests",
    page: "101-120",
    edition: "Revised",
    publisher: "Example Press",
    doi: "10.1000/chapter",
  },
];

describe("built-in bibliography field coverage", () => {
  for (const style of ["numeric", "author-date"] as const) {
    it(`${style} preserves journal, book and chapter publication fields`, () => {
      const result = formatCitations(
        entries,
        [{ items: entries.map(({ id }) => ({ id })) }],
        builtinCsl(style),
      );
      const byId = new Map(
        result.bibliography.map(({ id, text }) => [id, text]),
      );
      for (const value of [
        "Journal result",
        "Journal of Tests",
        "12(3)",
        "41–52",
        "https://doi.org/10.1000/journal",
        "https://example.org/journal",
      ])
        expect(byId.get("journal")).toContain(value);
      for (const value of [
        "The Art of Computer Programming",
        "vol. 1",
        "3rd ed.",
        "Addison-Wesley",
        "https://example.org/book",
      ])
        expect(byId.get("book")).toContain(value);
      for (const value of [
        "A chapter",
        "Collected Tests",
        "101–120",
        "Revised ed.",
        "Example Press",
        "https://doi.org/10.1000/chapter",
      ])
        expect(byId.get("chapter")).toContain(value);
      expect(result.unresolved).toEqual([]);
      expect(result.losses).toEqual([]);
    });

    it(`${style} suppresses empty publication groups and keeps citation syntax`, () => {
      const result = formatCitations(
        [
          {
            id: "sparse",
            title: "Sparse entry",
            authors: ["Doe, Jane"],
            issued: "2020",
          },
        ],
        [{ items: [{ id: "sparse" }] }],
        builtinCsl(style),
      );
      expect(result.citations).toEqual([
        style === "numeric" ? "[1]" : "(Doe, 2020)",
      ]);
      expect(result.bibliography[0]?.text).not.toMatch(
        /\(\)|\bed\.|\bvol\.|https:|\.\s*\./u,
      );
    });
  }

  it("preserves edition through BibTeX and CSL-JSON conversion", () => {
    const parsed = parseBibtex(
      "@book{knuth, author={Donald Knuth}, title={The Art}, year={1997}, edition={3}, publisher={Addison-Wesley}}",
    );
    expect(parsed[0]?.edition).toBe("3");
    expect(toBibtex(parsed)).toContain("edition = {3}");
    expect(JSON.parse(toCslJson(parsed))).toMatchObject([{ edition: "3" }]);
    expect(parseBibtex(toBibtex(parsed))[0]?.edition).toBe("3");
  });

  it("carries validated structured edition into native bibliography strings", () => {
    const data = bibliographyDefinition.schema.parse({ entries });
    expect(data.entries.find(({ id }) => id === "book")?.edition).toBe("3");
    const source = document({
      metadata: { title: "Bibliography fields", authors: [{ name: "Ada" }] },
      blocks: [
        createBlock({
          type: "publisle:paragraph",
          data: {
            content: [
              {
                type: "citationReference",
                items: entries.map(({ id }) => ({ id })),
              },
            ],
          },
        }),
        createBlock({ type: "publisle:bibliography", data }),
      ],
    });
    for (const template of ["article", "elsevier-author-date"] as const) {
      const { input } = createNativePdfPackage(source, {
        template,
        fonts: [{ path: "/pinned/serif.ttf", role: "regular" }],
      });
      const book = input.bibliography.find(({ id }) => id === "book");
      expect(book?.text).toContain("3rd ed.");
      expect(book?.text).toContain("Addison-Wesley");
      expect(
        input.article.entries.find(({ id }) => id === "book")?.edition,
      ).toBe("3");
    }
    expect(() =>
      bibliographyDefinition.schema.parse({
        entries: [{ id: "bad", edition: 3 }],
      }),
    ).toThrow(/edition must be a string/u);
  });
});

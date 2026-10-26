import { expect, it } from "vitest";
import { fromMarkdown } from "../../markdown/src/index.ts";
import { createNativePdfPackage } from "../src/native.ts";

function parse(source: string) {
  const result = fromMarkdown(source).document;
  if (!result) throw new Error("Invalid test fixture");
  return result;
}

const fonts = [{ path: "/pinned/serif.ttf", role: "regular" as const }];
const markdown = `---
title: Native test
authors:
  - name: Ada
---

# Introduction

Citation :cite[a]. A note.[^n]

[^n]: Note citation :cite[b].

Repeated :cite[a].

:::bibliography
\`\`\`json
[{"id":"a","title":"First","authors":["Example, Ada"],"issued":"2020"},{"id":"b","title":"Second","authors":["Example, Bea"],"issued":"2021"}]
\`\`\`
:::
`;
it("binds resolved citations before layout, retains metadata and maps projected blocks", () => {
  const document = parse(markdown);
  const original = structuredClone(document);
  const result = createNativePdfPackage(document, { fonts });
  expect(result.input.schemaVersion).toBe(1);
  expect(result.input.pdfStandard).toBe("ua-2");
  expect(result.input.article.title).toBe("Native test");
  expect(result.input.citations).toEqual(["[1]", "[2]", "[1]"]);
  expect(JSON.stringify(result.input.article)).toContain('"text":"[2]"');
  expect(result.blockIds).toHaveLength(result.input.article.blocks.length);
  expect(document).toEqual(original);
});
it("rejects missing metadata, missing fonts, unknown templates, and unresolved citations", () => {
  expect(() => createNativePdfPackage(parse("# Untitled"), { fonts })).toThrow(
    /title/,
  );
  const document = parse(markdown);
  expect(() => createNativePdfPackage(document, { fonts: [] })).toThrow(
    /fonts/,
  );
  expect(() =>
    createNativePdfPackage(document, { fonts, template: "unknown" as never }),
  ).toThrow(/template/);
  const unresolved = parse(markdown.replace(":cite[a]", ":cite[missing]"));
  expect(() => createNativePdfPackage(unresolved, { fonts })).toThrow(
    /Unresolved citations/,
  );
});

it("preserves the requested native PDF/UA flavour without downgrading", () => {
  const document = parse(markdown);
  expect(
    createNativePdfPackage(document, { fonts, pdfUa: "ua-1" }).input
      .pdfStandard,
  ).toBe("ua-1");
  expect(
    createNativePdfPackage(document, { fonts, pdfUa: false }).input.pdfStandard,
  ).toBeNull();
});

it("defaults unspecified Markdown table columns to native left alignment", () => {
  const document = parse(
    "---\ntitle: Table\nauthors:\n  - name: Ada\n---\n\n| Default | Center | Right |\n| --- | :---: | ---: |\n| A | B | C |\n",
  );
  const original = structuredClone(document);
  const result = createNativePdfPackage(document, { fonts });
  const table = result.input.article.blocks.find(
    (block) => block.kind === "table",
  );
  expect(table?.kind === "table" && table.align).toEqual([
    "left",
    "center",
    "right",
  ]);
  expect(document).toEqual(original);
});

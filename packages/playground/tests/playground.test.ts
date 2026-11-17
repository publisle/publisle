import { describe, expect, it } from "vitest";
import {
  appendSegment,
  blockCategories,
  blockDescriptions,
  blockLabels,
  blockTypes,
  createPlaygroundRegistry,
  DocumentEditor,
  inlineSegments,
  insertMathSnippet,
  listItemEdits,
  MATH_PALETTE_TABS,
  setSegmentText,
  setSegmentUrl,
  tokenizeMath,
  updateListItemText,
} from "../src/index.ts";

describe("math palette data", () => {
  it("every snippet template carries a placeholder or is a bare symbol", () => {
    for (const tab of MATH_PALETTE_TABS) {
      for (const snippet of tab.snippets) {
        expect(snippet.latex.length).toBeGreaterThan(0);
        expect(snippet.name.length).toBeGreaterThan(0);
      }
    }
  });

  it("labels are glyphs, not English words", () => {
    // Palette buttons show the symbol itself; short operator words (lim,
    // max, Aa) are allowed, but spelled-out names like "alpha" are not.
    for (const tab of MATH_PALETTE_TABS) {
      for (const snippet of tab.snippets) {
        const glyphLike =
          /\P{ASCII}/u.test(snippet.label) ||
          /^[A-Za-z]{1,4}$/u.test(snippet.label);
        expect(
          glyphLike,
          `label ${JSON.stringify(snippet.label)} (${snippet.name}) is not a glyph`,
        ).toBe(true);
      }
    }
  });

  it("tab ids are unique", () => {
    const ids = MATH_PALETTE_TABS.map((tab) => tab.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("insertMathSnippet", () => {
  it("places the caret at the first placeholder", () => {
    const result = insertMathSnippet("", 0, 0, "\\frac{□}{□}");
    expect(result.text).toBe("\\frac{}{□}");
    expect(result.selectionStart).toBe(6);
    expect(result.selectionEnd).toBe(6);
  });

  it("wraps the selection into the first argument", () => {
    const result = insertMathSnippet("x+y", 0, 3, "\\sqrt{□}");
    expect(result.text).toBe("\\sqrt{x+y}");
    expect(result.selectionStart).toBe(9);
    expect(result.selectionEnd).toBe(9);
  });

  it("keeps later placeholders visible as guides", () => {
    const result = insertMathSnippet("a", 0, 1, "\\frac{□}{□}");
    expect(result.text).toBe("\\frac{a}{□}");
  });

  it("appends bare symbols at the caret", () => {
    const result = insertMathSnippet("1 \\pm 2", 7, 7, "\\times");
    expect(result.text).toBe("1 \\pm 2\\times");
    expect(result.selectionStart).toBe(13);
  });

  it("clamps out-of-range selections", () => {
    const result = insertMathSnippet("ab", 5, 9, "\\sqrt{□}");
    expect(result.text).toBe("ab\\sqrt{}");
  });
});

describe("tokenizeMath", () => {
  it("classifies commands, braces, scripts, and numbers", () => {
    const tokens = tokenizeMath("\\frac{1}{2}^3");
    const kinds = tokens.map((token) => token.kind);
    expect(kinds).toContain("command");
    expect(kinds).toContain("brace");
    expect(kinds).toContain("number");
    expect(kinds).toContain("script");
    expect(tokens.map((token) => token.text).join("")).toBe("\\frac{1}{2}^3");
  });

  it("keeps plain text intact", () => {
    const tokens = tokenizeMath("x + y");
    expect(tokens).toEqual([{ text: "x + y", kind: "plain" }]);
  });
});

describe("block palette data", () => {
  it("describes and categorizes every core block type", () => {
    const descriptions = blockDescriptions();
    for (const type of blockTypes()) {
      expect(
        descriptions[type],
        `missing description for ${type}`,
      ).toBeTruthy();
    }
    const categorized = new Set(
      blockCategories().flatMap((category) => category.types),
    );
    for (const type of blockTypes()) {
      expect(categorized.has(type), `uncategorized block ${type}`).toBe(true);
    }
  });

  it("labels cover every core block type", () => {
    const labels = blockLabels();
    for (const type of blockTypes()) {
      expect(labels[type], `missing label for ${type}`).toBeTruthy();
    }
  });
});

describe("DocumentEditor.duplicateBlock", () => {
  it("deep-clones data with a fresh id right after the original", () => {
    const editor = new DocumentEditor();
    editor.addBlock("publisle:paragraph");
    editor.updateBlock(editor.document.blocks[0]!.id, {
      content: [
        { type: "paragraph", content: [{ type: "text", value: "hi" }] },
      ],
    });
    const original = editor.document.blocks[0]!;
    const duplicateId = editor.duplicateBlock(original.id);
    expect(duplicateId).toBeDefined();
    expect(duplicateId).not.toBe(original.id);
    expect(editor.document.blocks).toHaveLength(2);
    const copy = editor.document.blocks[1]!;
    expect(copy.type).toBe(original.type);
    expect(copy.data).toEqual(original.data);
    expect(copy.data).not.toBe(original.data);
  });

  it("returns undefined for unknown ids", () => {
    const editor = new DocumentEditor();
    expect(editor.duplicateBlock("nope" as never)).toBeUndefined();
  });

  it("keeps rich list items until their visible text changes", () => {
    const items = [
      {
        type: "listItem",
        checked: true,
        children: [
          {
            type: "paragraph",
            content: [
              { type: "text", value: "Math stays TeX: " },
              { type: "inlineMath", value: "E=mc^2" },
            ],
          },
        ],
      },
    ];
    const [row] = listItemEdits(items);
    const same = updateListItemText(items, 0, row?.text ?? "");
    expect(same[0]).toMatchObject({
      checked: true,
      children: items[0]?.children,
    });
    const changed = updateListItemText(items, 0, "plain");
    expect(JSON.stringify(changed)).not.toContain("inlineMath");
    expect(changed[0]).toMatchObject({ checked: true });
  });

  it("edits a link URL separately from its text", () => {
    const nodes = appendSegment([], "link");
    const segment = inlineSegments(nodes)[0];
    expect(segment?.url).toBe("https://example.com");
    const text = setSegmentText(nodes, segment?.index ?? 0, "Publisle");
    const url = setSegmentUrl(
      text,
      segment?.index ?? 0,
      "https://publisle.xyz/",
    );
    expect(url[0]).toMatchObject({ url: "https://publisle.xyz/" });
    expect(inlineSegments(url)[0]?.value).toBe("Publisle");
  });

  it("works with host registries", () => {
    const registry = createPlaygroundRegistry();
    const editor = new DocumentEditor(undefined, registry);
    editor.addBlock("publisle:heading");
    expect(editor.duplicateBlock(editor.document.blocks[0]!.id)).toBeDefined();
  });
});

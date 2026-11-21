import { describe, expect, it } from "vitest";
import {
  createBlock,
  document,
  parseDocument,
  RICH_TRAVERSAL_RULES,
  compileTraversal,
  traverseDeclared,
  resolvePointer,
  TraversalError,
  type TraversalDeclaration,
} from "@publisle/schema";
import {
  coreBlockDefinitions,
  paragraph,
  quote,
  figure,
} from "@publisle/blocks-core";
import {
  definePortableBlock,
  defineInteractiveBlock,
} from "../../block-sdk/src/index.ts";
import { accessibilityProfile } from "../../profiles/src/index.ts";
import {
  assertPrepared,
  createRegistry,
  prepare,
  getDocumentOutline,
  getBlockSourceDigest,
  inspectReadable,
} from "../src/index.ts";
import { createRenderPlan } from "../../adapter-core/src/index.ts";
import { compilePublication } from "../../adapter-core/src/publication.ts";
import fixture from "../../contracts/fixtures/meaning.json" with { type: "json" };

const text = (value: string) => ({ type: "text", value }) as const;
const para = (value: string) =>
  ({ type: "paragraph", content: [text(value)] }) as const;
const traversal: TraversalDeclaration = {
  root: {
    properties: {
      sections: { items: { ref: "entry" } },
      optional: { optional: true, items: { ref: "flow" } },
    },
  },
  rules: {
    ...RICH_TRAVERSAL_RULES,
    entry: {
      tag: {
        property: "type",
        cases: {
          heading: {
            emit: { kind: "node", type: "heading" },
            properties: { content: { items: { ref: "inline" } } },
          },
          paragraph: {
            emit: { kind: "node", type: "paragraph" },
            properties: { content: { items: { ref: "inline" } } },
          },
          figure: {
            emit: { kind: "node", type: "figure" },
            properties: { src: { emit: { kind: "resource" } } },
          },
        },
      },
    },
  },
};
const nested = definePortableBlock({
  type: "example:nested",
  schemaVersion: 1,
  traversal,
  schema: {
    parse(value): unknown {
      return value;
    },
  },
});

describe("bounded declared traversal", () => {
  it("uses one nested view for outline, references, resources and profiles", () => {
    const hidden = {
      type: "crossReference",
      target: "not-a-real-target",
      children: [text("Do not scan me")],
    };
    const block = createBlock({
      type: "example:nested",
      data: {
        sections: [
          {
            type: "heading",
            level: 1,
            label: "abstract",
            content: [text("Abstract")],
          },
          {
            type: "paragraph",
            content: [
              text("The nested abstract is substantive."),
              { type: "crossReference", target: "plot" },
              { type: "inlineImage", url: "inline.svg", alt: "Inset" },
            ],
          },
          { type: "figure", src: "plot.svg", label: "plot" },
          { type: "future-widget", hidden },
        ],
        opaque: hidden,
      },
    });
    const input = document({
      metadata: {
        title: "Nested paper",
        language: "en",
        authors: [{ name: "Ada", affiliation: "Lab" }],
      },
      blocks: [block],
    });
    const snapshot = structuredClone(input);
    const result = prepare(input, {
      registry: createRegistry([nested]),
      profiles: [accessibilityProfile()],
    });
    const prepared = assertPrepared(result);
    expect(getDocumentOutline(prepared)).toEqual([
      {
        blockId: block.id,
        level: 1,
        title: "Abstract",
        label: "abstract",
        pointer: "/sections/0",
      },
    ]);
    expect(prepared.references.targets).toMatchObject([
      { label: "abstract", kind: "heading", pointer: "/sections/0" },
      { label: "plot", kind: "figure", ordinal: 1, pointer: "/sections/2" },
    ]);
    expect(
      prepared.resources.resources.map((resource) => resource.uri).sort(),
    ).toEqual(["inline.svg", "plot.svg"]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "unresolved-traversal-branch",
      "missing-alternative-text",
    ]);
    expect(prepared.blocks[0]?.data).toEqual(block.data);
    expect(input).toEqual(snapshot);
  });
  it("finds cross references and inline resources in recursive built-in content", () => {
    const input = document({
      blocks: [
        figure({ src: "plot.svg", alt: "Plot", label: "plot" }),
        quote({
          children: [
            {
              type: "paragraph",
              content: [
                { type: "crossReference", target: "plot" },
                { type: "inlineImage", url: "nested.svg", alt: "Nested" },
              ],
            },
          ],
        }),
      ],
    });
    const prepared = assertPrepared(
      prepare(input, { registry: createRegistry(coreBlockDefinitions) }),
    );
    expect(
      prepared.resources.resources.map((resource) => resource.uri),
    ).toEqual(["nested.svg", "plot.svg"]);
    const broken = document({
      blocks: [
        paragraph({ content: [{ type: "crossReference", target: "absent" }] }),
      ],
    });
    expect(
      prepare(broken, { registry: createRegistry(coreBlockDefinitions) })
        .diagnostics[0]?.code,
    ).toBe("unresolved-cross-reference");
  });
  it("does not reinterpret undeclared code-first or unknown block payloads", () => {
    const opaque = definePortableBlock({
      type: "example:opaque",
      schemaVersion: 1,
      schema: {
        parse(value) {
          return value;
        },
      },
    });
    const data = {
      hidden: { type: "crossReference", target: "absent" },
      arbitrary: {
        type: "heading",
        level: 1,
        content: [text("Not a declared heading")],
      },
    };
    for (const registry of [createRegistry([opaque]), createRegistry([])]) {
      const result = prepare(
        document({ blocks: [createBlock({ type: "example:opaque", data })] }),
        { registry },
      );
      const prepared = assertPrepared(result);
      expect(getDocumentOutline(prepared)).toEqual([]);
      expect(prepared.blocks[0]?.data).toEqual(data);
      expect(
        result.diagnostics.some(
          (diagnostic) => diagnostic.code === "unresolved-cross-reference",
        ),
      ).toBe(false);
    }
  });
  it("fails missing locations, cycles and excessive programs without invoking hooks", () => {
    expect(() => traverseDeclared({}, traversal)).toThrow(TraversalError);
    const cycle = { root: { ref: "loop" }, rules: { loop: { ref: "loop" } } };
    expect(() => traverseDeclared({}, cycle)).toThrow(
      "Traversal evaluation limit exceeded",
    );
    const recursive = definePortableBlock({ ...nested, traversal: cycle });
    expect(
      prepare(
        document({ blocks: [createBlock({ type: nested.type, data: {} })] }),
        { registry: createRegistry([recursive]) },
      ).diagnostics[0]?.code,
    ).toBe("invalid-traversal");
    let calls = 0;
    const accessor = Object.defineProperty({}, "root", {
      enumerable: true,
      get() {
        calls++;
        return {};
      },
    });
    expect(() =>
      createRegistry([
        { ...nested, traversal: accessor as TraversalDeclaration },
      ]),
    ).toThrow();
    const executable = {
      root: {
        evaluate() {
          calls++;
        },
      },
    };
    expect(() =>
      traverseDeclared({}, executable as TraversalDeclaration),
    ).toThrow();
    const data = Object.defineProperty({}, "sections", {
      enumerable: true,
      get() {
        calls++;
        return [];
      },
    });
    expect(() => traverseDeclared(data, traversal)).toThrow();
    expect(calls).toBe(0);
    const wide = {
      root: {
        properties: Object.fromEntries(
          Array.from({ length: 4100 }, (_, index) => [String(index), {}]),
        ),
      },
    };
    expect(() => traverseDeclared({}, wide)).toThrow(
      "Traversal declaration limit exceeded",
    );
    expect(() =>
      traverseDeclared(
        { sections: Array.from({ length: 100_001 }, () => para("x")) },
        traversal,
      ),
    ).toThrow();
  });
  it("supports escaped literal property paths but never selectors or inherited properties", () => {
    expect(resolvePointer({ "a/b": { "~x": null } }, "/a~1b/~0x")).toEqual({
      found: true,
      value: null,
    });
    expect(resolvePointer({}, "/toString")).toEqual({ found: false });
    for (const pointer of ["x", "/~2", "/x/*", "/x/-", "/x/01"])
      expect(() => resolvePointer({ x: [1] }, pointer)).toThrow(TraversalError);
    expect(() =>
      traverseDeclared({}, { root: { properties: { "*": {} } } }),
    ).toThrow();
    expect(() => traverseDeclared({}, { root: { ref: "absent" } })).toThrow();
  });

  it("evaluates a compiled traversal against independent payloads", () => {
    const rule: TraversalDeclaration = {
      root: { properties: { text: { emit: { kind: "node" } } } },
    };
    const evaluate = compileTraversal(rule);
    const first = { text: "first" };
    expect(evaluate(first)).toEqual(traverseDeclared(first, rule));
    expect(() => evaluate({})).toThrow(TraversalError);
    const second = { text: "second" };
    expect(evaluate(second)).toEqual(traverseDeclared(second, rule));
  });
  it("includes declarative metadata in registry/cache identity without version bumps", () => {
    const first = createRegistry([nested]);
    const second = createRegistry([{ ...nested, traversal: { root: {} } }]);
    expect(first.version).not.toBe(second.version);
    const ordered = createRegistry([
      {
        ...nested,
        traversal: {
          root: { items: { emit: { kind: "resource", type: "asset" } } },
        },
      },
    ]);
    const reordered = createRegistry([
      {
        ...nested,
        traversal: {
          root: { items: { emit: { type: "asset", kind: "resource" } } },
        },
      },
    ]);
    expect(ordered.version).toBe(reordered.version);
    expect(nested.schemaVersion).toBe(1);
  });
});

describe("semantic binding integration", () => {
  const wave = definePortableBlock({
    type: "example:wave",
    schemaVersion: 1,
    schema: {
      parse(value) {
        return value;
      },
    },
    semantics: fixture.example
      .semantics as import("@publisle/schema").SemanticDeclaration,
  });
  it("prepares an unfamiliar declaration without loading a renderer", () => {
    const result = prepare(
      document({
        blocks: [createBlock({ type: wave.type, data: fixture.example.data })],
      }),
      { registry: createRegistry([wave]) },
    );
    expect(result.document).toBeDefined();
    expect(result.diagnostics).toEqual([]);
  });
  it("reports exact declaration pointers and leaves original invalid source unchanged", () => {
    const input = document({
      blocks: [createBlock({ type: wave.type, data: { payload: {} } })],
    });
    const snapshot = structuredClone(input);
    const result = prepare(input, { registry: createRegistry([wave]) });
    expect(result.document).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "unresolved-semantic-binding",
        pointer: "/entities/1/binding",
        blockId: input.blocks[0]?.id,
      }),
    );
    expect(input).toEqual(snapshot);
  });
  it("retains the standard interactive slots and validates preset associations", () => {
    const definition = defineInteractiveBlock({
      type: "example:interactive",
      schemaVersion: 1,
      descriptor: {
        displayName: "Wave",
        description: "Portable description",
        payloadSchema: { type: "object", properties: {} },
      },
      schema: {
        parse(value) {
          return value;
        },
      },
    });
    const block = createBlock({
      type: definition.type,
      data: { activation: "visible", ...fixture.example.data },
    });
    expect(
      prepare(document({ blocks: [block] }), {
        registry: createRegistry([definition]),
      }).document?.traversal?.some(
        (visit) => visit.pointer === "/content/purpose/0",
      ),
    ).toBe(true);
    const broken = structuredClone(block);
    const preset = broken.data.content.presets[0];
    if (!preset) throw new Error("Expected preset fixture.");
    preset.binding = "/missing";
    expect(
      prepare(document({ blocks: [broken] }), {
        registry: createRegistry([definition]),
      }).diagnostics[0]?.code,
    ).toBe("unresolved-preset-binding");
  });
});

describe("readable unknown-block preservation", () => {
  it("warns without losing unknown content when readable references cannot resolve", () => {
    const block = createBlock({ type: "future:refs", data: null });
    const readable = {
      sourceDigest: getBlockSourceDigest(block),
      provenance: { kind: "authored" as const },
      content: {
        description: [
          {
            type: "paragraph",
            content: [
              {
                type: "crossReference",
                target: "unavailable",
                children: [text("Authored unknown reference")],
              },
            ],
          },
        ],
        presets: [{ id: "initial", binding: "/absent" }],
      },
    };
    const result = prepare(document({ blocks: [{ ...block, readable }] }), {
      registry: createRegistry([]),
    });
    expect(result.document).toBeDefined();
    expect(
      result.diagnostics.every((diagnostic) => diagnostic.level === "warning"),
    ).toBe(true);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unresolved-preset-binding",
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "unresolved-cross-reference",
    );
    expect(compilePublication(assertPrepared(result)).html).toContain(
      "Authored unknown reference",
    );
  });
  function unknown() {
    const block = createBlock({
      type: "future:wave",
      data: structuredClone(fixture.example.data),
    });
    return {
      ...block,
      readable: {
        sourceDigest: getBlockSourceDigest(block),
        provenance: { kind: "authored" as const },
        binding: "/content",
      },
    };
  }
  it("retains raw payload and substantive article prose when the contract and renderer are absent", () => {
    const block = unknown();
    const source = document({ blocks: [block] });
    const roundtrip = parseDocument(
      JSON.parse(JSON.stringify(source)) as unknown,
    );
    expect(roundtrip).toEqual(source);
    const result = prepare(roundtrip, { registry: createRegistry([]) });
    const prepared = assertPrepared(result);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "unknown-block-type",
    ]);
    expect(prepared.blocks[0]?.data).toEqual(block.data);
    expect(inspectReadable(block)).toEqual(block.data.content);
    expect(JSON.stringify(createRenderPlan(prepared).nodes)).toContain(
      "Compare a wave",
    );
    expect(compilePublication(prepared).html).toContain("Compare a wave");
    expect(source.blocks[0]?.readable).not.toHaveProperty("content");
  });
  it("prefers authored fallback and does not execute HTML or load renderer code", () => {
    const block = createBlock({ type: "future:canvas", data: [1, 2, 3] });
    const readable = {
      sourceDigest: getBlockSourceDigest(block),
      provenance: { kind: "authored" as const },
      content: {
        description: [para("Secondary description")],
        fallback: [para("Authored print fallback <script>alert(1)</script>")],
      },
    };
    const prepared = assertPrepared(
      prepare(document({ blocks: [{ ...block, readable }] }), {
        registry: createRegistry([]),
      }),
    );
    const html = compilePublication(prepared).html;
    expect(html).toContain("Authored print fallback");
    expect(html).not.toContain("Secondary description");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
  it("does not present stale projections as current facts; preserves the sidecar for recovery", () => {
    const block = unknown();
    block.data.payload.frequency = 3;
    const result = prepare(document({ blocks: [block] }), {
      registry: createRegistry([]),
    });
    const prepared = assertPrepared(result);
    expect(result.diagnostics[0]?.code).toBe("stale-readable-representation");
    expect(prepared.blocks[0]?.readable).toEqual(block.readable);
    expect(prepared.blocks[0]?.readableContent).toBeUndefined();
    expect(JSON.stringify(createRenderPlan(prepared).nodes)).not.toContain(
      "Compare a wave",
    );
  });
  it("reports missing bound prose while preserving opaque payload", () => {
    const block = unknown();
    const result = prepare(
      document({
        blocks: [
          { ...block, readable: { ...block.readable, binding: "/absent" } },
        ],
      }),
      { registry: createRegistry([]) },
    );
    expect(result.diagnostics[0]?.code).toBe("unresolved-readable-binding");
    expect(result.document?.blocks[0]?.data).toEqual(block.data);
  });
  it("labels generated prose with generator/version provenance", () => {
    const block = createBlock({ type: "future:generated", data: null });
    const prepared = assertPrepared(
      prepare(
        document({
          blocks: [
            {
              ...block,
              readable: {
                sourceDigest: getBlockSourceDigest(block),
                provenance: {
                  kind: "generated",
                  generator: "host:summary",
                  version: "beta",
                  source: "source.json",
                },
                content: { fallback: [para("Generated, not authored.")] },
              },
            },
          ],
        }),
        { registry: createRegistry([]) },
      ),
    );
    expect(compilePublication(prepared).html).toContain(
      "Generated by host:summary",
    );
  });
});

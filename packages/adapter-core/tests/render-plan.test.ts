import { describe, expect, it } from "vitest";
import {
  coreBlockDefinitions,
  diagram,
  embed,
  figure,
  heading,
  math,
  paragraph,
} from "@publisle/blocks-core";
import {
  interactiveSchematic,
  interactiveSchematicDefinition,
} from "@publisle/blocks-technical";
import { createRegistry, prepare } from "@publisle/core";
import {
  document,
  createIslandInput,
  isInteractiveEnvelope,
} from "@publisle/schema";
import { createRenderPlan, compilePublication } from "../src/index.ts";

describe("createRenderPlan", () => {
  const registry = createRegistry([
    ...coreBlockDefinitions,
    interactiveSchematicDefinition,
  ]);

  it("keeps standalone and explicit reference labels while avoiding authored prefixes", () => {
    const input = document({
      blocks: [
        figure({ src: "plot.svg", alt: "Plot", label: "fig:plot" }),
        paragraph({
          content: [
            { type: "crossReference", target: "fig:plot" },
            { type: "text", value: "; Figure " },
            { type: "crossReference", target: "fig:plot" },
            { type: "text", value: "; " },
            {
              type: "crossReference",
              target: "fig:plot",
              children: [{ type: "text", value: "the plot" }],
            },
          ],
        }),
      ],
    });
    const prepared = prepare(input, { registry }).document;
    if (!prepared) throw new Error("Fixture preparation failed");
    const html = compilePublication(prepared).html;
    expect(html).toMatch(
      />Figure 1<\/a>; Figure <a[^>]*>1<\/a>; <a[^>]*>the plot<\/a>/u,
    );
  });

  it("plans a registered static visualization with the full interactive envelope", () => {
    const input = document({
      blocks: [
        interactiveSchematic({
          activation: "interaction",
          payload: { source: "./counter.json" },
          content: { title: [{ type: "text", value: "Counter" }] },
        }),
      ],
    });
    const prepared = prepare(input, { registry }).document;
    if (!prepared) throw new Error("Expected prepared fixture.");
    const staticRenderer = { module: "./StaticCounter", exportName: "Counter" };
    for (const interactive of [undefined, { module: "./InteractiveCounter" }]) {
      const plan = createRenderPlan(prepared, {
        renderers: {
          "publisle:interactive-schematic": {
            static: staticRenderer,
            ...(interactive === undefined ? {} : { interactive }),
          },
        },
      });
      const first = input.blocks[0];
      if (!first || !isInteractiveEnvelope(first.data))
        throw new Error("Expected valid envelope.");
      expect(JSON.stringify(plan.nodes)).toContain(
        JSON.stringify({
          kind: "component",
          module: staticRenderer.module,
          exportName: staticRenderer.exportName,
          blockId: input.blocks[0]?.id,
          props: createIslandInput(first, first.data),
          artifact: [],
        }),
      );
      expect(
        plan.diagnostics.some(
          (item) => item.code === "missing-static-representation",
        ),
      ).toBe(false);
    }
  });

  it("retains pinned provenance and authored prose when an interactive renderer is missing", () => {
    const input = document({
      blocks: [
        interactiveSchematic({
          activation: "interaction",
          payload: { source: "./counter.json" },
          fallback: [
            {
              type: "paragraph",
              content: [
                { type: "text", value: "The clock advances the counter." },
              ],
            },
          ],
        }),
      ],
    });
    const prepared = prepare(input, { registry }).document;
    if (!prepared) throw new Error("Expected prepared fixture");
    const pin = {
      type: "publisle:interactive-schematic" as const,
      schemaVersion: 1,
      id: `urn:publisle:contract:sha256:${"a".repeat(64)}`,
      digest: `sha256:${"a".repeat(64)}` as const,
    };
    const plan = createRenderPlan({ ...prepared, dependencies: [pin] });
    const html = compilePublication(plan).html;
    expect(html).toContain(`data-publisle-contract="${pin.id} ${pin.digest}"`);
    expect(html).toContain("The clock advances the counter.");
    expect(
      plan.diagnostics.some((item) => item.code === "missing-island-renderer"),
    ).toBe(true);
  });

  it("keeps the explanation outside the island and activates from a button", () => {
    const input = document({
      blocks: [
        interactiveSchematic({
          activation: "interaction",
          content: {
            title: [{ type: "text", value: "Clocked counter" }],
            description: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    value: "Observe the output on each clock edge.",
                  },
                ],
              },
            ],
          },
          fallback: [
            {
              type: "paragraph",
              content: [{ type: "text", value: "The counter starts at zero." }],
            },
          ],
          accessibility: { label: "Interactive clocked counter" },
          payload: { source: "./counter.json" },
        }),
      ],
    });
    const prepared = prepare(input, { registry }).document;
    expect(prepared).toBeDefined();
    if (!prepared) throw new Error("Expected a prepared document.");
    expect(prepared.resources.resources[0]?.uri).toBe("counter.json");
    const plan = createRenderPlan(prepared, {
      renderers: {
        "publisle:interactive-schematic": { module: "./Schematic.js" },
      },
    });
    expect(plan.nodes[0]).toMatchObject({
      kind: "element",
      tag: "section",
      children: [
        {
          kind: "element",
          tag: "p",
          children: [{ kind: "text", value: "Clocked counter" }],
        },
        {
          kind: "element",
          tag: "p",
          children: [
            { kind: "text", value: "Observe the output on each clock edge." },
          ],
        },
        {
          kind: "island",
          activation: "interaction",
          label: "Interactive clocked counter",
          props: {
            activation: "interaction",
            payload: { source: "./counter.json" },
          },
          fallback: [
            {
              kind: "element",
              tag: "p",
              children: [
                { kind: "text", value: "The counter starts at zero." },
              ],
            },
            {
              kind: "element",
              tag: "button",
              attributes: { "data-publisle-activate": "true" },
              children: [{ kind: "text", value: "Explore Clocked counter" }],
            },
          ],
        },
      ],
    });
    const island =
      plan.nodes[0]?.kind === "element" ? plan.nodes[0].children[2] : undefined;
    expect(island).toMatchObject({ kind: "island" });
    if (island?.kind !== "island") throw new Error("Expected an island.");
    expect(
      island.fallback.some(
        (node) => node.kind === "element" && node.tag === "dl",
      ),
    ).toBe(false);
  });

  it("warns when an interactive block has no static representation", () => {
    const input = document({
      blocks: [
        interactiveSchematic({
          activation: "visible",
          payload: { source: "./counter.json" },
        }),
      ],
    });
    const prepared = prepare(input, { registry }).document;
    expect(prepared).toBeDefined();
    if (!prepared) throw new Error("Expected a prepared document.");
    const plan = createRenderPlan(prepared);
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "missing-static-representation" }),
    );
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "missing-island-renderer" }),
    );
    expect(plan.nodes[0]).toMatchObject({ kind: "element", tag: "section" });
  });

  it("uses the descriptor display name when an interactive label is omitted", () => {
    const prepared = prepare(
      document({
        blocks: [
          interactiveSchematic({
            activation: "visible",
            fallback: [
              {
                type: "paragraph",
                content: [{ type: "text", value: "Static schematic" }],
              },
            ],
            payload: { source: "./counter.json" },
          }),
        ],
      }),
      { registry },
    ).document;
    if (!prepared) throw new Error("Expected prepared document.");
    expect(prepared.islands[0]?.displayName).toBe("Interactive schematic");
    const plan = createRenderPlan(prepared, {
      renderers: {
        "publisle:interactive-schematic": { module: "./Schematic.js" },
      },
    });
    expect(plan.nodes[0]).toMatchObject({
      children: [expect.objectContaining({ label: "Interactive schematic" })],
    });
  });

  it("indexes cross-references and renders color-aware KaTeX", () => {
    const input = document({
      blocks: [
        heading({
          level: 2,
          label: "sec:start",
          content: [{ type: "text", value: "Start" }],
        }),
        figure({ src: "flow.svg", alt: "Flow", label: "fig:flow" }),
        paragraph({
          content: [
            { type: "crossReference", target: "fig:flow" },
            { type: "text", value: " " },
            { type: "inlineMath", value: "\\textcolor{red}{x}" },
          ],
        }),
        math({ value: "\\color{blue} y", display: true, label: "eq:y" }),
      ],
    });
    const prepared = prepare(input, { registry }).document;
    expect(prepared?.references?.targets).toMatchObject([
      { label: "sec:start", kind: "heading", title: "Start" },
      { label: "fig:flow", kind: "figure", ordinal: 1 },
      { label: "eq:y", kind: "equation", ordinal: 1 },
    ]);
    if (!prepared) throw new Error("Expected prepared document.");
    const plan = createRenderPlan(prepared);
    expect(JSON.stringify(plan.nodes)).toContain("Figure 1");
    expect(JSON.stringify(plan.nodes)).toContain("katex");
    expect(plan.diagnostics).toEqual([]);
  });

  it("renders figure renditions for hosts to map onto their themes", () => {
    const prepared = prepare(
      document({
        blocks: [
          figure({
            src: "flow.svg",
            alt: "Flow",
            variants: { dark: "flow-dark.svg" },
          }),
        ],
      }),
      { registry },
    ).document;
    if (!prepared) throw new Error("Expected prepared document.");
    const html = compilePublication(prepared).html;
    expect(html).toContain('class="publisle-figure-themed"');
    expect(html).toContain('src="flow.svg"');
    expect(html).toContain('src="flow-dark.svg"');
    expect(html).toContain('data-publisle-variant="dark"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("shows a placeholder for an empty figure and a warning for an unsafe URL", () => {
    const empty = prepare(
      document({ blocks: [figure({ src: "", alt: "Plot" })] }),
      { registry },
    ).document;
    if (!empty) throw new Error("Expected prepared document.");
    const emptyHtml = compilePublication(empty).html;
    expect(emptyHtml).toContain("Add an image URL");
    expect(emptyHtml).not.toContain("unsafe");
    const unsafe = prepare(
      document({
        blocks: [figure({ src: "javascript:alert(1)", alt: "Plot" })],
      }),
      { registry },
    );
    expect(unsafe.diagnostics.some((item) => item.code === "unsafe-url")).toBe(
      false,
    );
    if (!unsafe.document) throw new Error("Expected prepared document.");
    const unsafePublication = compilePublication(unsafe.document);
    expect(unsafePublication.html).toContain(
      "An unsafe figure URL was removed.",
    );
    expect(
      unsafePublication.diagnostics.some((item) => item.code === "unsafe-url"),
    ).toBe(true);
  });

  it("renders restricted embeds and diagram fallbacks", () => {
    const prepared = prepare(
      document({
        blocks: [
          embed({
            provider: "youtube",
            resourceId: "dQw4w9WgXcQ",
            title: "Video",
            aspectRatio: { width: 16, height: 9 },
          }),
          diagram({
            engine: "mermaid",
            source: "graph TD",
            alt: "Graph",
            fallback: [
              {
                type: "paragraph",
                content: [{ type: "text", value: "Graph fallback" }],
              },
            ],
          }),
        ],
      }),
      { registry },
    ).document;
    if (!prepared) throw new Error("Expected prepared document.");
    const plan = createRenderPlan(prepared);
    expect(JSON.stringify(plan.nodes)).toContain(
      "youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    expect(JSON.stringify(plan.nodes)).toContain("Graph fallback");
    expect(plan.diagnostics).toContainEqual(
      expect.objectContaining({ code: "missing-diagram-renderer" }),
    );
  });

  it("rejects unresolved cross-references during preparation", () => {
    const result = prepare(
      document({
        blocks: [
          paragraph({
            content: [{ type: "crossReference", target: "fig:missing" }],
          }),
        ],
      }),
      { registry },
    );
    expect(result.document).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unresolved-cross-reference" }),
    );
  });
});

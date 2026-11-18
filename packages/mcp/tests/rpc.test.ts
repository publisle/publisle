import { describe, expect, it } from "vitest";
import {
  MAX_BATCH,
  PROTOCOL_VERSIONS,
  TOOL_NAMES,
  handleRpc,
  handleRpcText,
  sampleDocument,
  type JsonObject,
  type McpHost,
  type RpcOutcome,
  type ToolResult,
} from "../src/index.ts";

let counter = 0;
async function rpc(
  method: string,
  params?: unknown,
  host?: McpHost,
): Promise<JsonObject> {
  const out = await handleRpc(
    { jsonrpc: "2.0", id: ++counter, method, params },
    host ? { host } : {},
  );
  if (out.kind !== "single") throw new Error("expected a single response");
  return out.response as unknown as JsonObject;
}

async function call(
  name: string,
  args: JsonObject,
  host?: McpHost,
): Promise<ToolResult> {
  const response = await rpc("tools/call", { name, arguments: args }, host);
  return response["result"] as ToolResult;
}

function structured(result: ToolResult): JsonObject {
  if (!result.structuredContent) throw new Error("no structured content");
  return result.structuredContent;
}

describe("protocol", () => {
  it("negotiates the protocol version", async () => {
    const shared = await rpc("initialize", { protocolVersion: "2025-06-18" });
    expect((shared["result"] as JsonObject)["protocolVersion"]).toBe(
      "2025-06-18",
    );
    const unknown = await rpc("initialize", { protocolVersion: "1999-01-01" });
    expect((unknown["result"] as JsonObject)["protocolVersion"]).toBe(
      PROTOCOL_VERSIONS[0],
    );
    expect((unknown["result"] as JsonObject)["capabilities"]).toMatchObject({
      tools: {},
      resources: {},
      prompts: {},
    });
  });

  it("answers ping and lists every tool with a schema", async () => {
    expect((await rpc("ping"))["result"]).toEqual({});
    const listing = (await rpc("tools/list"))["result"] as {
      tools: { name: string; inputSchema: JsonObject }[];
    };
    expect(listing.tools.map((tool) => tool.name)).toEqual([...TOOL_NAMES]);
    for (const tool of listing.tools)
      expect(tool.inputSchema["type"]).toBe("object");
  });

  it("gives notifications and client responses no reply", async () => {
    const none: RpcOutcome = { kind: "none" };
    expect(
      await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ).toEqual(none);
    expect(await handleRpc({ jsonrpc: "2.0", id: 9, result: {} })).toEqual(
      none,
    );
  });

  it("reports parse, request and method errors with standard codes", async () => {
    const parse = await handleRpcText("{nope");
    expect(parse).toMatchObject({
      kind: "single",
      response: { error: { code: -32700 } },
    });
    expect(await handleRpc("hello")).toMatchObject({
      response: { error: { code: -32600 } },
    });
    expect((await rpc("nope/method"))["error"]).toMatchObject({ code: -32601 });
    expect(
      (await rpc("tools/call", { name: "does_not_exist" }))["error"],
    ).toMatchObject({ code: -32602 });
    expect(
      (await rpc("tools/call", { name: "validate", arguments: "x" }))["error"],
    ).toMatchObject({ code: -32602 });
  });

  it("answers batches and bounds their size", async () => {
    const out = await handleRpc([
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ]);
    expect(out.kind === "batch" && out.responses.length).toBe(2);
    const huge = Array.from({ length: MAX_BATCH + 1 }, (_, id) => ({
      jsonrpc: "2.0",
      id,
      method: "ping",
    }));
    expect(await handleRpc(huge)).toMatchObject({
      response: { error: { code: -32600 } },
    });
  });

  it("serves resources and prompts", async () => {
    const listing = (await rpc("resources/list"))["result"] as {
      resources: { uri: string }[];
    };
    expect(listing.resources.map((entry) => entry.uri)).toContain(
      "publisle://examples/sample",
    );
    const read = (
      await rpc("resources/read", { uri: "publisle://examples/sample" })
    )["result"] as { contents: { text: string }[] };
    expect(JSON.parse(read.contents[0]?.text ?? "")).toEqual(
      JSON.parse(JSON.stringify(sampleDocument())),
    );
    expect(
      (await rpc("resources/read", { uri: "publisle://missing" }))["error"],
    ).toMatchObject({ code: -32602 });
    const prompt = (
      await rpc("prompts/get", {
        name: "draft_article",
        arguments: { topic: "tides" },
      })
    )["result"] as { messages: { content: { text: string } }[] };
    expect(prompt.messages[0]?.content.text).toContain("tides");
  });
});

describe("authoring tools", () => {
  it("builds, edits and validates a document end to end", async () => {
    const created = structured(
      await call("new_document", {
        metadata: {
          title: "Tides",
          language: "en",
          authors: [{ name: "Ada" }],
        },
      }),
    );
    let document = created["document"];

    const heading = structured(
      await call("add_block", { document, type: "publisle:heading" }),
    );
    document = heading["document"];
    const second = structured(
      await call("add_block", {
        document,
        type: "publisle:paragraph",
        data: { content: [{ type: "text", value: "Water moves." }] },
      }),
    );
    document = second["document"];
    expect((document as { blocks: unknown[] }).blocks).toHaveLength(2);

    const moved = structured(
      await call("move_block", {
        document,
        blockId: second["blockId"],
        direction: "up",
      }),
    );
    expect(moved["index"]).toBe(0);
    document = moved["document"];

    const copied = structured(
      await call("duplicate_block", { document, blockId: heading["blockId"] }),
    );
    document = copied["document"];
    expect((document as { blocks: unknown[] }).blocks).toHaveLength(3);
    expect(copied["blockId"]).not.toBe(heading["blockId"]);

    const updated = structured(
      await call("update_block", {
        document,
        blockId: heading["blockId"],
        data: { level: 1, content: [{ type: "text", value: "Tides" }] },
      }),
    );
    document = updated["document"];

    const removed = structured(
      await call("remove_block", { document, blockId: copied["blockId"] }),
    );
    document = removed["document"];
    expect((document as { blocks: unknown[] }).blocks).toHaveLength(2);

    const validation = structured(await call("validate", { document }));
    expect(validation["valid"]).toBe(true);
    const outline = structured(await call("outline", { document }));
    expect(outline["outline"]).toMatchObject([{ level: 1, title: "Tides" }]);
    const metadata = structured(
      await call("set_metadata", {
        document,
        metadata: { title: "Renamed", authors: [{ name: "Ada" }] },
      }),
    );
    expect(
      (metadata["document"] as { metadata: { title: string } }).metadata.title,
    ).toBe("Renamed");
  });

  it("accepts the document as a JSON string", async () => {
    const result = await call("validate", {
      document: JSON.stringify(sampleDocument()),
    });
    expect(structured(result)["valid"]).toBe(true);
  });

  it("matches the editor used by the playground", async () => {
    const { DocumentEditor, createPlaygroundRegistry } =
      await import("@publisle/playground/core");
    const base = sampleDocument();
    const editor = new DocumentEditor(base, createPlaygroundRegistry());
    editor.addBlock("publisle:quote", 1);
    const viaTool = structured(
      await call("add_block", {
        document: base,
        type: "publisle:quote",
        index: 1,
      }),
    )["document"] as { blocks: { type: string }[] };
    expect(viaTool.blocks.map((block) => block.type)).toEqual(
      editor.document.blocks.map((block) => block.type),
    );
  });

  it("round-trips Markdown", async () => {
    const imported = structured(
      await call("import_markdown", {
        markdown: "---\ntitle: Hello\n---\n\n# Hello\n\nSome *text*.\n",
      }),
    );
    const exported = structured(
      await call("export_markdown", { document: imported["document"] }),
    );
    expect(exported["markdown"]).toContain("# Hello");
    const archival = structured(
      await call("export_markdown", {
        document: imported["document"],
        policy: "archival",
      }),
    );
    expect(typeof archival["markdown"]).toBe("string");
    const again = structured(
      await call("import_json", {
        source: JSON.stringify(imported["document"]),
      }),
    );
    expect(again["document"]).toEqual(imported["document"]);
  });

  it("renders HTML, outline and references", async () => {
    const document = sampleDocument();
    const html = structured(await call("render_html", { document }));
    expect(String(html["html"])).toContain("Notes on the Fourier transform");
    expect(String(html["html"])).toContain("math");
    expect(structured(await call("references", { document }))).toHaveProperty(
      "references",
    );
  });

  it("lists block types that the registry can validate", async () => {
    const { blocks } = structured(await call("list_blocks", {})) as {
      blocks: { type: string; label: string; defaultData: unknown }[];
    };
    expect(blocks.map((block) => block.type)).toContain("publisle:paragraph");
    expect(blocks.every((block) => block.label.length > 0)).toBe(true);
    // Every default must produce a document that validates.
    for (const block of blocks) {
      const added = structured(
        await call("add_block", {
          document: structured(await call("new_document", {}))["document"],
          type: block.type,
        }),
      );
      const validation = structured(
        await call("validate", { document: added["document"] }),
      );
      expect(validation["valid"], block.type).toBe(true);
    }
  });
});

describe("tool errors", () => {
  it("returns isError results the assistant can act on", async () => {
    const document = sampleDocument();
    const bad = await call("add_block", { document, type: "publisle:nope" });
    expect(bad.isError).toBe(true);
    expect(structured(bad)["blockTypes"]).toBeInstanceOf(Array);

    const missing = await call("remove_block", { document, blockId: "x" });
    expect(missing.isError).toBe(true);
    expect(structured(missing)["blockIds"]).toBeInstanceOf(Array);

    const invalid = await call("validate", { document: { blocks: "no" } });
    expect(invalid.isError).toBe(true);

    const notJson = await call("validate", { document: "{" });
    expect(structured(notJson)["error"]).toContain("not valid JSON");

    const direction = await call("move_block", {
      document,
      blockId: (document.blocks[0] as { id: string }).id,
      direction: "sideways",
    });
    expect(direction.isError).toBe(true);
  });

  it("rejects documents that do not validate before rendering", async () => {
    const result = await call("render_html", {
      document: {
        schemaVersion: 1,
        blocks: [
          {
            id: "6f4d0f6e-8f0a-4c2e-9a53-1d3f4b2a7c99",
            type: "publisle:heading",
            schemaVersion: 1,
            data: { level: 9 },
          },
        ],
      },
    });
    expect(result.isError).toBe(true);
  });
});

describe("pdf tools", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7 fake");
  const host: McpHost = {
    templates: () => [{ id: "article", engines: ["rust"] }],
    compilePdf: (request) => {
      expect(request.template).toBe("article");
      return Promise.resolve({
        pdf,
        diagnostics: [{ code: "note", message: "ok" }],
      });
    },
  };

  it("lists templates and returns the PDF as a resource", async () => {
    expect(
      structured(await call("list_templates", {}, host))["templates"],
    ).toHaveLength(1);
    const result = await call(
      "compile_pdf",
      { document: sampleDocument() },
      host,
    );
    expect(result.isError).toBeUndefined();
    expect(structured(result)).toMatchObject({
      engine: "rust",
      sizeBytes: pdf.length,
    });
    const resource = result.content.find((entry) => entry.type === "resource");
    expect(resource).toMatchObject({
      resource: { mimeType: "application/pdf" },
    });
    expect(
      atob((resource as { resource: { blob: string } }).resource.blob),
    ).toBe("%PDF-1.7 fake");
  });

  it("requires exactly one source and a host with a compiler", async () => {
    expect((await call("compile_pdf", {}, host)).isError).toBe(true);
    expect(
      (
        await call(
          "compile_pdf",
          { document: sampleDocument(), markdown: "# x" },
          host,
        )
      ).isError,
    ).toBe(true);
    expect((await call("compile_pdf", { markdown: "# x" })).isError).toBe(true);
    expect((await call("list_templates", {})).isError).toBe(true);
  });

  it("surfaces host failures as readable tool errors", async () => {
    const limited: McpHost = {
      compilePdf: () =>
        Promise.reject(
          Object.assign(new Error("Too many requests."), {
            code: "quota",
            diagnostics: [{ code: "quota", message: "slow down" }],
          }),
        ),
    };
    const result = await call("compile_pdf", { markdown: "# x" }, limited);
    expect(result.isError).toBe(true);
    expect(structured(result)).toMatchObject({
      error: "Too many requests.",
      code: "quota",
    });
  });
});

import { compilePublicationAsync } from "@publisle/adapter-core/async";
import {
  getDocumentOutline,
  getDocumentReferences,
  prepare,
  type BlockRegistry,
} from "@publisle/core";
import { fromMarkdown, toMarkdown } from "@publisle/markdown";
import {
  blockCategories,
  blockDescriptions,
  blockLabels,
  blockTypes,
  createPlaygroundRegistry,
  defaultData,
  DocumentEditor,
} from "@publisle/playground/core";
import {
  document as buildDocument,
  parseDocument,
  type BlockId,
  type Diagnostic,
  type Document,
} from "@publisle/schema";
import type {
  CallContext,
  JsonObject,
  ToolContent,
  ToolResult,
} from "./types.ts";

/** An error the assistant can read and act on; reported as `isError`. */
export class ToolError extends Error {
  readonly details: JsonObject | undefined;
  constructor(message: string, details?: JsonObject) {
    super(message);
    this.details = details;
  }
}

export interface ToolDefinition {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonObject;
  readonly annotations: JsonObject;
  /** Editing tools are bounded by a deadline; PDF export has its own queue. */
  readonly bounded: boolean;
  readonly run: (
    args: JsonObject,
    context: CallContext,
  ) => Promise<ToolResult> | ToolResult;
}

let cachedRegistry: BlockRegistry | undefined;
function registry(): BlockRegistry {
  cachedRegistry ??= createPlaygroundRegistry();
  return cachedRegistry;
}

/** Types that are both editable in the playground and known to the registry. */
function editableTypes(): readonly string[] {
  const known = registry().definitions;
  return blockTypes().filter((type) => known.has(type));
}

function ok(data: JsonObject, extra: readonly ToolContent[] = []): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }, ...extra],
    structuredContent: data,
  };
}

function requireString(args: JsonObject, key: string): string {
  const value = args[key];
  if (typeof value !== "string")
    throw new ToolError(`\`${key}\` must be a string.`);
  return value;
}

function optionalString(args: JsonObject, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string")
    throw new ToolError(`\`${key}\` must be a string.`);
  return value;
}

function optionalInteger(
  args: JsonObject,
  key: string,
  minimum: number,
  maximum: number,
): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new ToolError(
      `\`${key}\` must be an integer from ${String(minimum)} to ${String(maximum)}.`,
    );
  return value;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonValue(value: unknown, key: string): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ToolError(`\`${key}\` is not valid JSON.`);
  }
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : "The document is invalid.";
}

/** Accepts the document as an object or as a JSON string (some models quote it). */
function loadDocument(args: JsonObject, key = "document"): Document {
  const value = parseJsonValue(args[key], key);
  if (value === undefined) throw new ToolError(`\`${key}\` is required.`);
  try {
    return parseDocument(value);
  } catch (error) {
    throw new ToolError(`\`${key}\` is not a valid Publisle document.`, {
      reason: describeFailure(error),
    });
  }
}

function blockIdFrom(editor: DocumentEditor, args: JsonObject): BlockId {
  const id = requireString(args, "blockId");
  const block = editor.document.blocks.find((entry) => entry.id === id);
  if (!block)
    throw new ToolError(`No block has id ${id}.`, {
      blockIds: editor.document.blocks.map((entry) => entry.id),
    });
  return block.id;
}

/** Re-parse after every edit so a tool can never hand back an invalid document. */
function finish(editor: DocumentEditor, extra: JsonObject = {}): ToolResult {
  let next: Document;
  try {
    next = parseDocument(JSON.parse(JSON.stringify(editor.document)));
  } catch (error) {
    throw new ToolError("The edit produced an invalid document.", {
      reason: describeFailure(error),
    });
  }
  return ok({ ...extra, document: next });
}

function diagnosticsOf(
  diagnostics: readonly Diagnostic[],
): readonly Diagnostic[] {
  return diagnostics;
}

function isErrorFree(diagnostics: readonly Diagnostic[]): boolean {
  return !diagnostics.some((entry) => entry.level === "error");
}

const documentProperty = {
  description:
    "The Publisle document: an object with schemaVersion and blocks, as returned by the other tools.",
  type: "object",
} as const;

const blockIdProperty = {
  description: "The id of a block in the document.",
  type: "string",
} as const;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const PURE_EDIT = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
} as const;

function schema(
  properties: JsonObject,
  required: readonly string[] = [],
): JsonObject {
  return {
    type: "object",
    properties,
    required: [...required],
    additionalProperties: false,
  };
}

export function blockCatalog(): readonly JsonObject[] {
  const labels = blockLabels();
  const descriptions = blockDescriptions();
  const categories = blockCategories();
  return editableTypes().map((type) => ({
    type,
    label: labels[type] ?? type,
    description: descriptions[type] ?? "",
    category: categories.find((entry) => entry.types.includes(type))?.id ?? "",
    defaultData: defaultData(type),
  }));
}

function requireBlockType(type: string): void {
  if (!editableTypes().includes(type))
    throw new ToolError(`Unknown block type ${type}.`, {
      blockTypes: editableTypes(),
    });
}

export const TOOLS: readonly ToolDefinition[] = [
  {
    name: "list_blocks",
    title: "List block types",
    description:
      "List every block type with its label, description, category and default data. Use the default data as the shape to follow when updating a block.",
    inputSchema: schema({}),
    annotations: READ_ONLY,
    bounded: true,
    run: () => ok({ blocks: blockCatalog() }),
  },
  {
    name: "list_templates",
    title: "List PDF templates",
    description:
      "List the PDF templates, their engines and any extra metadata fields a template requires.",
    inputSchema: schema({}),
    annotations: READ_ONLY,
    bounded: true,
    run: (_args, { host }) => {
      if (!host.templates)
        throw new ToolError("PDF export is not available on this host.");
      return ok({
        templates: host.templates(),
        requiredMetadata: ["title", "authors"],
      });
    },
  },
  {
    name: "new_document",
    title: "Start a document",
    description:
      "Create an empty document, optionally with metadata such as title, authors, language and description.",
    inputSchema: schema({
      metadata: {
        type: "object",
        description:
          "Publication metadata: title, description, language, authors[{name, affiliation}], subjects[].",
      },
    }),
    annotations: PURE_EDIT,
    bounded: true,
    run: (args) => {
      const metadata = args["metadata"];
      if (metadata !== undefined && !isRecord(metadata))
        throw new ToolError("`metadata` must be an object.");
      let created: Document;
      try {
        created = parseDocument(
          JSON.parse(
            JSON.stringify(
              buildDocument({
                blocks: [],
                ...(metadata === undefined
                  ? {}
                  : { metadata: metadata }),
              }),
            ),
          ),
        );
      } catch (error) {
        throw new ToolError("The metadata is invalid.", {
          reason: describeFailure(error),
        });
      }
      return ok({ document: created });
    },
  },
  {
    name: "set_metadata",
    title: "Replace metadata",
    description:
      "Replace the document metadata. Pass the complete metadata object; omitted fields are removed.",
    inputSchema: schema(
      { document: documentProperty, metadata: { type: "object" } },
      ["document", "metadata"],
    ),
    annotations: PURE_EDIT,
    bounded: true,
    run: (args) => {
      const editor = new DocumentEditor(loadDocument(args), registry());
      const metadata = args["metadata"];
      if (!isRecord(metadata))
        throw new ToolError("`metadata` must be an object.");
      editor.setMetadata(metadata);
      return finish(editor);
    },
  },
  {
    name: "add_block",
    title: "Add a block",
    description:
      "Insert a block. Omit `index` to append. Omit `data` to use the default content for the type, then call update_block to fill it in.",
    inputSchema: schema(
      {
        document: documentProperty,
        type: { type: "string", description: "A type from list_blocks." },
        index: { type: "integer", minimum: 0 },
        data: { description: "Block data; defaults to the type's default." },
      },
      ["document", "type"],
    ),
    annotations: PURE_EDIT,
    bounded: true,
    run: (args) => {
      const editor = new DocumentEditor(loadDocument(args), registry());
      const type = requireString(args, "type");
      requireBlockType(type);
      const length = editor.document.blocks.length;
      const index = Math.min(
        optionalInteger(args, "index", 0, 100_000) ?? length,
        length,
      );
      editor.addBlock(type, index);
      const added = editor.document.blocks[index];
      if (!added) throw new ToolError("The block could not be added.");
      if (args["data"] !== undefined)
        editor.updateBlock(added.id, parseJsonValue(args["data"], "data"));
      return finish(editor, { blockId: added.id, index });
    },
  },
  {
    name: "update_block",
    title: "Update a block",
    description:
      "Replace the data of one block. Send the complete data object for the block type.",
    inputSchema: schema(
      {
        document: documentProperty,
        blockId: blockIdProperty,
        data: { description: "The complete new block data." },
      },
      ["document", "blockId", "data"],
    ),
    annotations: PURE_EDIT,
    bounded: true,
    run: (args) => {
      const editor = new DocumentEditor(loadDocument(args), registry());
      const id = blockIdFrom(editor, args);
      if (args["data"] === undefined)
        throw new ToolError("`data` is required.");
      editor.updateBlock(id, parseJsonValue(args["data"], "data"));
      return finish(editor, { blockId: id });
    },
  },
  {
    name: "remove_block",
    title: "Remove a block",
    description: "Delete one block from the document.",
    inputSchema: schema(
      { document: documentProperty, blockId: blockIdProperty },
      ["document", "blockId"],
    ),
    annotations: PURE_EDIT,
    bounded: true,
    run: (args) => {
      const editor = new DocumentEditor(loadDocument(args), registry());
      const id = blockIdFrom(editor, args);
      editor.removeBlock(id);
      return finish(editor, { removed: id });
    },
  },
  {
    name: "move_block",
    title: "Move a block",
    description:
      "Move a block up or down by one or more positions. The block stops at either end.",
    inputSchema: schema(
      {
        document: documentProperty,
        blockId: blockIdProperty,
        direction: { type: "string", enum: ["up", "down"] },
        steps: { type: "integer", minimum: 1, maximum: 100 },
      },
      ["document", "blockId", "direction"],
    ),
    annotations: PURE_EDIT,
    bounded: true,
    run: (args) => {
      const editor = new DocumentEditor(loadDocument(args), registry());
      const id = blockIdFrom(editor, args);
      const direction = requireString(args, "direction");
      if (direction !== "up" && direction !== "down")
        throw new ToolError("`direction` must be `up` or `down`.");
      const steps = optionalInteger(args, "steps", 1, 100) ?? 1;
      for (let step = 0; step < steps; step++) editor.moveBlock(id, direction);
      return finish(editor, {
        blockId: id,
        index: editor.document.blocks.findIndex((block) => block.id === id),
      });
    },
  },
  {
    name: "duplicate_block",
    title: "Duplicate a block",
    description:
      "Copy a block with a fresh id. The copy is inserted directly after the original.",
    inputSchema: schema(
      { document: documentProperty, blockId: blockIdProperty },
      ["document", "blockId"],
    ),
    annotations: PURE_EDIT,
    bounded: true,
    run: (args) => {
      const editor = new DocumentEditor(loadDocument(args), registry());
      const copy = editor.duplicateBlock(blockIdFrom(editor, args));
      if (!copy) throw new ToolError("The block could not be duplicated.");
      return finish(editor, { blockId: copy });
    },
  },
  {
    name: "import_markdown",
    title: "Import Markdown",
    description:
      "Convert Markdown (with optional YAML front matter, GFM tables, math and directives) into a Publisle document.",
    inputSchema: schema({ markdown: { type: "string" } }, ["markdown"]),
    annotations: PURE_EDIT,
    bounded: true,
    run: (args) => {
      const imported = fromMarkdown(requireString(args, "markdown"));
      if (!imported.document)
        throw new ToolError("The Markdown could not be imported.", {
          diagnostics: diagnosticsOf(imported.diagnostics),
        });
      const next = parseDocument(JSON.parse(JSON.stringify(imported.document)));
      return ok({
        document: next,
        diagnostics: diagnosticsOf(imported.diagnostics),
      });
    },
  },
  {
    name: "export_markdown",
    title: "Export Markdown",
    description:
      "Convert a document to Markdown. Policy `fallback` (default) keeps readable text for blocks Markdown cannot express; `archival` preserves every block losslessly.",
    inputSchema: schema(
      {
        document: documentProperty,
        policy: { type: "string", enum: ["fallback", "archival"] },
      },
      ["document"],
    ),
    annotations: READ_ONLY,
    bounded: true,
    run: (args) => {
      const policy = optionalString(args, "policy") ?? "fallback";
      if (policy !== "fallback" && policy !== "archival")
        throw new ToolError("`policy` must be `fallback` or `archival`.");
      const exported = toMarkdown(loadDocument(args), { policy });
      return ok({
        markdown: exported.markdown,
        diagnostics: diagnosticsOf(exported.diagnostics),
      });
    },
  },
  {
    name: "import_json",
    title: "Import a JSON document",
    description:
      "Parse and normalize a document from a JSON string, reporting why it is invalid when it is.",
    inputSchema: schema({ source: { type: "string" } }, ["source"]),
    annotations: PURE_EDIT,
    bounded: true,
    run: (args) =>
      ok({
        document: loadDocument({ document: requireString(args, "source") }),
      }),
  },
  {
    name: "validate",
    title: "Validate a document",
    description:
      "Prepare the document and return diagnostics. `valid` is true when no diagnostic has level `error`.",
    inputSchema: schema({ document: documentProperty }, ["document"]),
    annotations: READ_ONLY,
    bounded: true,
    run: (args) => {
      const result = prepare(loadDocument(args), { registry: registry() });
      return ok({
        valid: result.document !== undefined && isErrorFree(result.diagnostics),
        blockCount: result.document?.blocks.length ?? 0,
        diagnostics: diagnosticsOf(result.diagnostics),
      });
    },
  },
  {
    name: "outline",
    title: "Document outline",
    description: "List the headings in reading order with their levels.",
    inputSchema: schema({ document: documentProperty }, ["document"]),
    annotations: READ_ONLY,
    bounded: true,
    run: (args) => ok({ outline: getDocumentOutline(prepared(args)) }),
  },
  {
    name: "references",
    title: "Document references",
    description:
      "List labelled targets (headings, figures, equations, tables) with their numbering.",
    inputSchema: schema({ document: documentProperty }, ["document"]),
    annotations: READ_ONLY,
    bounded: true,
    run: (args) =>
      ok({ references: getDocumentReferences(prepared(args)) }),
  },
  {
    name: "render_html",
    title: "Render HTML preview",
    description:
      "Compile the document to the same static HTML the website preview shows.",
    inputSchema: schema({ document: documentProperty }, ["document"]),
    annotations: READ_ONLY,
    bounded: true,
    run: async (args) => {
      const artifact = await compilePublicationAsync(prepared(args));
      return ok({
        html: artifact.html,
        identity: artifact.identity,
        diagnostics: artifact.diagnostics,
      });
    },
  },
  {
    name: "compile_pdf",
    title: "Export a PDF",
    description:
      "Compile a PDF with the Rust compiler. Supply exactly one of `document` or `markdown`. The document needs a title and at least one author. Returns the PDF as a base64 `application/pdf` resource.",
    inputSchema: schema({
      document: documentProperty,
      markdown: { type: "string" },
      template: {
        type: "string",
        description: "A template id from list_templates. Defaults to article.",
      },
      data: {
        type: "object",
        description: "Extra template metadata, such as {country} for ACM.",
      },
    }),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    bounded: false,
    run: async (args, { host, signal }) => {
      if (!host.compilePdf)
        throw new ToolError("PDF export is not available on this host.");
      const hasDocument = args["document"] !== undefined;
      const hasMarkdown = args["markdown"] !== undefined;
      if (hasDocument === hasMarkdown)
        throw new ToolError("Supply exactly one of `document` or `markdown`.");
      const data = args["data"] ?? {};
      if (!isRecord(data)) throw new ToolError("`data` must be an object.");
      const template = optionalString(args, "template") ?? "article";
      const request = hasDocument
        ? { document: loadDocument(args), template, data }
        : { markdown: requireString(args, "markdown"), template, data };
      const result = await host.compilePdf(request, signal);
      return ok(
        {
          template,
          engine: "rust",
          sizeBytes: result.pdf.length,
          diagnostics: [...result.diagnostics],
        },
        [
          {
            type: "resource",
            resource: {
              uri: "publisle://pdf/document.pdf",
              mimeType: "application/pdf",
              blob: toBase64(result.pdf),
            },
          },
        ],
      );
    },
  },
];

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

function prepared(args: JsonObject) {
  const result = prepare(loadDocument(args), { registry: registry() });
  if (!result.document || !isErrorFree(result.diagnostics))
    throw new ToolError("The document does not validate.", {
      diagnostics: diagnosticsOf(result.diagnostics),
    });
  return result.document;
}

export const TOOL_NAMES: readonly string[] = TOOLS.map((tool) => tool.name);

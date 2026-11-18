import { PROMPTS, promptMessages, RESOURCES } from "./content.ts";
import { TOOLS, ToolError } from "./tools.ts";
import type {
  JsonObject,
  JsonRpcFailure,
  JsonRpcId,
  JsonRpcResponse,
  McpHost,
  ToolResult,
} from "./types.ts";

/** Newest first. The server answers `initialize` with the newest it shares. */
export const PROTOCOL_VERSIONS: readonly string[] = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];

export const SERVER_INFO = {
  name: "publisle",
  title: "Publisle",
  version: "0.1.0",
} as const;

const INSTRUCTIONS =
  "Publisle documents are JSON made of typed blocks. The server keeps no state: " +
  "pass the whole `document` to each tool and use the `document` it returns. " +
  "Start with new_document or import_markdown, call list_blocks for block types, " +
  "edit with add_block and update_block, check with validate, and export with compile_pdf.";

/** Longest an editing tool may run before the call fails. */
export const EDIT_DEADLINE_MS = 5000;
export const MAX_BATCH = 16;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

export interface HandleOptions {
  readonly host?: McpHost;
  readonly signal?: AbortSignal;
}

function failure(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcFailure {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ProtocolError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function withDeadline<T>(
  work: Promise<T> | T,
  milliseconds: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ToolError("The tool exceeded its time limit."));
    }, milliseconds);
    Promise.resolve(work).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

function errorResult(error: ToolError): ToolResult {
  const structuredContent: JsonObject = {
    error: error.message,
    ...(error.details ?? {}),
  };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError: true,
  };
}

async function callTool(
  params: unknown,
  options: HandleOptions,
): Promise<ToolResult> {
  if (!isRecord(params) || typeof params["name"] !== "string")
    throw new ProtocolError(INVALID_PARAMS, "`name` is required.");
  const tool = TOOLS.find((entry) => entry.name === params["name"]);
  if (!tool)
    throw new ProtocolError(
      INVALID_PARAMS,
      `Unknown tool: ${params["name"].slice(0, 80)}`,
    );
  const args = params["arguments"] ?? {};
  if (!isRecord(args))
    throw new ProtocolError(INVALID_PARAMS, "`arguments` must be an object.");
  const context = {
    host: options.host ?? {},
    signal: options.signal ?? new AbortController().signal,
  };
  try {
    const work = Promise.resolve().then(() => tool.run(args, context));
    return await (tool.bounded ? withDeadline(work, EDIT_DEADLINE_MS) : work);
  } catch (error) {
    if (error instanceof ToolError) return errorResult(error);
    if (context.signal.aborted) throw error;
    const known = error as { code?: unknown; message?: unknown } | undefined;
    // Host failures (queue full, quota, compiler diagnostics) are actionable.
    if (typeof known?.code === "string" && typeof known.message === "string")
      return errorResult(
        new ToolError(known.message, {
          code: known.code,
          ...(Array.isArray((error as { diagnostics?: unknown }).diagnostics)
            ? {
                diagnostics: (error as { diagnostics: unknown[] }).diagnostics,
              }
            : {}),
        }),
      );
    return errorResult(new ToolError("The tool failed unexpectedly."));
  }
}

function toolListing() {
  return TOOLS.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }));
}

async function dispatch(
  method: string,
  params: unknown,
  options: HandleOptions,
): Promise<unknown> {
  switch (method) {
    case "initialize": {
      const requested = isRecord(params)
        ? params["protocolVersion"]
        : undefined;
      const protocolVersion =
        typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : PROTOCOL_VERSIONS[0];
      return {
        protocolVersion,
        capabilities: {
          tools: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
          prompts: { listChanged: false },
        },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      };
    }
    case "ping":
      return {};
    case "tools/list":
      return { tools: toolListing() };
    case "tools/call":
      return callTool(params, options);
    case "resources/list":
      return {
        resources: RESOURCES.map(({ read: _read, ...entry }) => entry),
      };
    case "resources/templates/list":
      return { resourceTemplates: [] };
    case "resources/read": {
      const uri = isRecord(params) ? params["uri"] : undefined;
      const resource = RESOURCES.find((entry) => entry.uri === uri);
      if (!resource)
        throw new ProtocolError(INVALID_PARAMS, "Unknown resource.");
      return {
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType,
            text: resource.read(),
          },
        ],
      };
    }
    case "prompts/list":
      return { prompts: PROMPTS };
    case "prompts/get": {
      if (!isRecord(params) || typeof params["name"] !== "string")
        throw new ProtocolError(INVALID_PARAMS, "`name` is required.");
      const given = params["arguments"];
      const messages = promptMessages(
        params["name"],
        isRecord(given) ? given : {},
      );
      if (!messages) throw new ProtocolError(INVALID_PARAMS, "Unknown prompt.");
      return { description: PROMPTS[0]?.description ?? "", messages };
    }
    default:
      throw new ProtocolError(
        METHOD_NOT_FOUND,
        `Method not found: ${method.slice(0, 80)}`,
      );
  }
}

async function handleOne(
  message: unknown,
  options: HandleOptions,
): Promise<JsonRpcResponse | undefined> {
  if (!isRecord(message) || message["jsonrpc"] !== "2.0")
    return failure(null, INVALID_REQUEST, "Not a JSON-RPC 2.0 message.");
  const hasId = Object.hasOwn(message, "id");
  const id = message["id"];
  const method = message["method"];
  // Responses and notifications get no reply.
  if (typeof method !== "string") {
    if (hasId && ("result" in message || "error" in message)) return undefined;
    return failure(
      hasId && (typeof id === "string" || typeof id === "number") ? id : null,
      INVALID_REQUEST,
      "`method` is required.",
    );
  }
  if (!hasId) return undefined;
  if (typeof id !== "string" && typeof id !== "number")
    return failure(null, INVALID_REQUEST, "`id` must be a string or number.");
  try {
    return {
      jsonrpc: "2.0",
      id,
      result: await dispatch(method, message["params"], options),
    };
  } catch (error) {
    if (error instanceof ProtocolError)
      return failure(id, error.code, error.message);
    if (options.signal?.aborted) return undefined;
    return failure(id, INTERNAL_ERROR, "Internal error.");
  }
}

export type RpcOutcome =
  | { readonly kind: "none" }
  | { readonly kind: "single"; readonly response: JsonRpcResponse }
  | { readonly kind: "batch"; readonly responses: readonly JsonRpcResponse[] };

/**
 * Handle one decoded JSON-RPC payload. Notifications and client responses yield
 * `none` (HTTP 202); a batch of only notifications also yields `none`.
 */
export async function handleRpc(
  payload: unknown,
  options: HandleOptions = {},
): Promise<RpcOutcome> {
  if (Array.isArray(payload)) {
    if (payload.length === 0 || payload.length > MAX_BATCH)
      return {
        kind: "single",
        response: failure(
          null,
          INVALID_REQUEST,
          `Batches must hold 1 to ${String(MAX_BATCH)} messages.`,
        ),
      };
    const responses: JsonRpcResponse[] = [];
    for (const message of payload) {
      const response = await handleOne(message, options);
      if (response) responses.push(response);
    }
    return responses.length === 0
      ? { kind: "none" }
      : { kind: "batch", responses };
  }
  const response = await handleOne(payload, options);
  return response ? { kind: "single", response } : { kind: "none" };
}

/** Decode request text, answering malformed JSON with a parse error. */
export async function handleRpcText(
  text: string,
  options: HandleOptions = {},
): Promise<RpcOutcome> {
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch {
    return {
      kind: "single",
      response: failure(null, PARSE_ERROR, "Parse error."),
    };
  }
  return handleRpc(payload, options);
}

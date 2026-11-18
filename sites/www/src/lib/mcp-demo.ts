// A scripted MCP session for the /mcp page. It speaks real JSON-RPC to either
// the hosted endpoint or the same handler running in the browser, so what the
// visitor sees is the protocol, not a recording.

export interface DemoInputs {
  readonly title: string;
  readonly paragraph: string;
  readonly equation: string;
}

export interface TranscriptEntry {
  readonly id: number;
  readonly label: string;
  readonly note: string;
  readonly request: unknown;
  /** `undefined` when the server correctly sends no reply (notifications). */
  readonly response: unknown;
  readonly status: number;
  readonly ms: number;
  readonly ok: boolean;
  readonly summary: string;
}

export interface Transport {
  readonly name: "hosted" | "browser";
  readonly send: (
    message: unknown,
  ) => Promise<{ readonly status: number; readonly body: unknown }>;
}

export interface DemoResult {
  readonly document?: unknown;
  readonly html?: string;
  readonly pdf?: Blob;
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: string) {
  return { type: "text", value };
}

/** The hosted endpoint, or the browser fallback when it cannot be reached. */
export function hostedTransport(apiUrl: string, timeoutMs = 60000): Transport {
  return {
    name: "hosted",
    send: async (message) => {
      const response = await fetch(`${apiUrl}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const raw = await response.text();
      return {
        status: response.status,
        body: raw ? (JSON.parse(raw) as unknown) : undefined,
      };
    },
  };
}

export async function browserTransport(): Promise<Transport> {
  const { handleRpc } = await import("@publisle/mcp");
  return {
    name: "browser",
    send: async (message) => {
      const outcome = await handleRpc(message);
      if (outcome.kind === "none") return { status: 202, body: undefined };
      return {
        status: 200,
        body: outcome.kind === "single" ? outcome.response : outcome.responses,
      };
    },
  };
}

/** Is the hosted endpoint reachable and speaking MCP? */
export async function probeHosted(apiUrl: string): Promise<boolean> {
  try {
    const { status, body } = await hostedTransport(apiUrl, 4000).send({
      jsonrpc: "2.0",
      id: 0,
      method: "ping",
    });
    return status === 200 && isRecord(body) && isRecord(body.result);
  } catch {
    return false;
  }
}

/** Shorten long strings so a transcript stays readable. */
export function abbreviate(value: unknown, limit = 400): string {
  return JSON.stringify(
    value,
    (key, entry: unknown) => {
      if (key === "blob" && typeof entry === "string")
        return `<${String(Math.floor((entry.length * 3) / 4))} bytes, base64>`;
      if (typeof entry === "string" && entry.length > limit)
        return `${entry.slice(0, limit)}… (${String(entry.length - limit)} more characters)`;
      return entry;
    },
    2,
  );
}

function base64ToBlob(data: string, type: string): Blob {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

interface Call {
  readonly label: string;
  readonly note: string;
  readonly message: Json;
  /** Reads the response; returns a one-line summary. */
  readonly read: (response: unknown) => string;
}

function toolResult(response: unknown): {
  readonly content: readonly Json[];
  readonly data: Json;
  readonly isError: boolean;
} {
  const result = isRecord(response) ? response.result : undefined;
  if (!isRecord(result)) return { content: [], data: {}, isError: true };
  const content = Array.isArray(result.content)
    ? (result.content as Json[])
    : [];
  const data = isRecord(result.structuredContent)
    ? result.structuredContent
    : {};
  return { content, data, isError: result.isError === true };
}

function protocolError(response: unknown): string | undefined {
  if (!isRecord(response)) return "No JSON-RPC response.";
  const error = response.error;
  return isRecord(error) && typeof error.message === "string"
    ? error.message
    : undefined;
}

/**
 * Runs the session. Calls `onEntry` as each exchange completes. A protocol
 * failure stops the run; a tool reporting `isError` is shown and the run goes on.
 */
export async function runSession(
  transport: Transport,
  inputs: DemoInputs,
  onEntry: (entry: TranscriptEntry) => void,
  signal?: AbortSignal,
): Promise<DemoResult> {
  let id = 0;
  let document: unknown;
  let html: string | undefined;
  let pdf: Blob | undefined;
  const blockIds: string[] = [];

  const request = (method: string, params?: Json): Json => ({
    jsonrpc: "2.0",
    id: ++id,
    method,
    ...(params === undefined ? {} : { params }),
  });
  const tool = (name: string, args: Json): Json =>
    request("tools/call", { name, arguments: args });

  const plan: (() => Call)[] = [
    () => ({
      label: "initialize",
      note: "The client says hello and the server picks a shared protocol version.",
      message: request("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "publisle-demo", version: "1.0.0" },
      }),
      read: (response) => {
        const result = isRecord(response) ? response.result : undefined;
        if (!isRecord(result)) return "No result.";
        const info = result.serverInfo;
        return `${isRecord(info) ? String(info.name) : "server"} speaks protocol ${String(result.protocolVersion)}`;
      },
    }),
    () => ({
      label: "notifications/initialized",
      note: "A notification: the server accepts it and sends no reply.",
      message: { jsonrpc: "2.0", method: "notifications/initialized" },
      read: () => "Accepted without a reply (HTTP 202).",
    }),
    () => ({
      label: "tools/list",
      note: "The server describes every tool with a JSON Schema.",
      message: request("tools/list"),
      read: (response) => {
        const result = isRecord(response) ? response.result : undefined;
        const tools =
          isRecord(result) && Array.isArray(result.tools)
            ? (result.tools as Json[])
            : [];
        return `${String(tools.length)} tools: ${tools
          .slice(0, 5)
          .map((entry) => String(entry.name))
          .join(", ")}…`;
      },
    }),
    () => ({
      label: "new_document",
      note: "Start an empty document. The server keeps nothing: the document comes back to the client.",
      message: tool("new_document", {
        metadata: {
          title: inputs.title,
          language: "en",
          authors: [{ name: "Demo Author" }],
        },
      }),
      read: (response) => {
        document = toolResult(response).data.document;
        return "Created a document with metadata.";
      },
    }),
    () => ({
      label: "add_block (heading)",
      note: "Add a typed heading block. The whole document goes up and the new one comes back.",
      message: tool("add_block", {
        document,
        type: "publisle:heading",
        data: { level: 1, content: [text(inputs.title)] },
      }),
      read: (response) => {
        const data = toolResult(response).data;
        document = data.document ?? document;
        if (typeof data.blockId === "string") blockIds.push(data.blockId);
        return "Added a heading.";
      },
    }),
    () => ({
      label: "add_block (paragraph)",
      note: "Blocks are inserted at the end unless an index is given.",
      message: tool("add_block", {
        document,
        type: "publisle:paragraph",
        data: { content: [text(inputs.paragraph)] },
      }),
      read: (response) => {
        const data = toolResult(response).data;
        document = data.document ?? document;
        if (typeof data.blockId === "string") blockIds.push(data.blockId);
        return "Added a paragraph.";
      },
    }),
    () => ({
      label: "add_block (math)",
      note: "Math is a block too, with a LaTeX value.",
      message: tool("add_block", {
        document,
        type: "publisle:math",
        data: { value: inputs.equation, display: true },
      }),
      read: (response) => {
        const data = toolResult(response).data;
        document = data.document ?? document;
        return "Added a display equation.";
      },
    }),
    () => ({
      label: "validate",
      note: "Prepare the document and report diagnostics.",
      message: tool("validate", { document }),
      read: (response) => {
        const data = toolResult(response).data;
        const diagnostics = Array.isArray(data.diagnostics)
          ? data.diagnostics.length
          : 0;
        return data.valid === true
          ? `Valid: ${String(data.blockCount)} blocks, ${String(diagnostics)} diagnostics.`
          : `Not valid: ${String(diagnostics)} diagnostics.`;
      },
    }),
    () => ({
      label: "render_html",
      note: "Compile the document to the same static HTML the playground previews.",
      message: tool("render_html", { document }),
      read: (response) => {
        const data = toolResult(response).data;
        html = typeof data.html === "string" ? data.html : undefined;
        return html
          ? `Rendered ${String(html.length)} characters of HTML.`
          : "No HTML returned.";
      },
    }),
    () => ({
      label: "compile_pdf",
      note: "Export a PDF. On the hosted endpoint the Rust compiler does this work.",
      message: tool("compile_pdf", { document, template: "article" }),
      read: (response) => {
        const { content, data, isError } = toolResult(response);
        if (isError)
          return `Tool error: ${typeof data.error === "string" ? data.error : "failed"}`;
        const resource = content.find((entry) => entry.type === "resource");
        const inner = isRecord(resource?.resource)
          ? resource.resource
          : undefined;
        if (inner && typeof inner.blob === "string")
          pdf = base64ToBlob(inner.blob, "application/pdf");
        return `PDF compiled with the ${String(data.engine)} engine: ${String(data.sizeBytes)} bytes.`;
      },
    }),
  ];

  let entryId = 0;
  for (const next of plan) {
    if (signal?.aborted) break;
    const call = next();
    const started = performance.now();
    let status = 0;
    let response: unknown;
    let failure: string | undefined;
    try {
      const sent = await transport.send(call.message);
      status = sent.status;
      response = sent.body;
    } catch (error) {
      failure = error instanceof Error ? error.message : "Request failed.";
    }
    const ms = Math.round(performance.now() - started);
    const isNotification = !("id" in call.message);
    const protocol =
      failure ?? (isNotification ? undefined : protocolError(response));
    const tool = toolResult(response);
    const ok =
      protocol === undefined &&
      (isNotification ? status === 202 : !tool.isError);
    const summary = protocol
      ? `Protocol error: ${protocol}`
      : call.read(response);
    onEntry({
      id: ++entryId,
      label: call.label,
      note: call.note,
      request: call.message,
      response,
      status,
      ms,
      ok,
      summary,
    });
    if (protocol !== undefined) break;
  }
  return {
    ...(document === undefined ? {} : { document }),
    ...(html === undefined ? {} : { html }),
    ...(pdf === undefined ? {} : { pdf }),
  };
}

export const DEFAULT_INPUTS: DemoInputs = {
  title: "Notes on the Fourier transform",
  paragraph:
    "A periodic signal is a sum of sines. The transform recovers the amplitude of each one.",
  equation: "X(f)=\\int x(t)e^{-2\\pi i f t}\\,dt",
};

export const CLIENT_CONFIG = `{
  "mcpServers": {
    "publisle": { "url": "https://api.publisle.xyz/mcp" }
  }
}`;

export const CURL_EXAMPLE = `curl -s https://api.publisle.xyz/mcp \\
  -H 'content-type: application/json' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_blocks","arguments":{}}}'`;

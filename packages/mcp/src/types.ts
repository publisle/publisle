export type JsonObject = Record<string, unknown>;

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id?: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcSuccess {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result: unknown;
}

export interface JsonRpcFailure {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export type ToolContent =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "resource";
      readonly resource: {
        readonly uri: string;
        readonly mimeType: string;
        readonly blob: string;
      };
    };

export interface ToolResult {
  readonly content: readonly ToolContent[];
  readonly structuredContent?: JsonObject;
  readonly isError?: boolean;
}

export interface PdfRequest {
  readonly markdown?: string;
  readonly document?: unknown;
  readonly template: string;
  readonly data: JsonObject;
}

export interface PdfResult {
  readonly pdf: Uint8Array;
  readonly diagnostics: readonly unknown[];
}

/**
 * Capabilities supplied by whoever embeds the handler. The handler itself never
 * touches files or the network; PDF export is the host's compiler (the Rust
 * `publisle-pdf` binary behind the API's queue and quota).
 */
export interface McpHost {
  readonly templates?: () => readonly unknown[];
  readonly compilePdf?: (
    request: PdfRequest,
    signal: AbortSignal,
  ) => Promise<PdfResult>;
}

export interface CallContext {
  readonly host: McpHost;
  readonly signal: AbortSignal;
}

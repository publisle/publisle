export const API_URL: string =
  (import.meta.env.PUBLIC_API_URL as string | undefined) ??
  "https://api.publisle.xyz";

export const PDF_ENABLED: boolean =
  import.meta.env.PUBLIC_PDF_ENABLED === "true";

export interface ApiHealth {
  readonly status: string;
  readonly service?: string;
  readonly services?: { readonly pdf?: boolean };
}

export interface ApiDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly blockIndex?: number;
}

export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly message: string;
      readonly diagnostics?: readonly ApiDiagnostic[];
    };

export async function fetchHealth(
  timeoutMs = 4000,
): Promise<ApiResult<ApiHealth>> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const response = await fetch(`${API_URL}/health`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        ok: false,
        message: `Health check failed (${String(response.status)}).`,
      };
    }
    return { ok: true, value: (await response.json()) as ApiHealth };
  } catch (cause) {
    return {
      ok: false,
      message:
        cause instanceof Error ? cause.message : "API endpoint unreachable.",
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface PdfTemplate {
  readonly id: string;
  readonly label: string;
  readonly engines: readonly ("pdflatex" | "lualatex" | "rust")[];
  readonly fields?: readonly string[];
}

export async function fetchPdfTemplates(): Promise<readonly PdfTemplate[]> {
  try {
    const response = await fetch(`${API_URL}/pdf/capabilities`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { templates?: PdfTemplate[] };
    return payload.templates ?? [];
  } catch {
    return [];
  }
}

export type CompilePdfRequest = {
  readonly template: string;
  readonly engine?: "pdflatex" | "lualatex" | "rust";
  readonly data?: { readonly country?: string };
} & (
  | {
      readonly document: import("@publisle/schema").Document;
      readonly markdown?: never;
    }
  | { readonly markdown: string; readonly document?: never }
);

export type CompilePdfResult = ApiResult<{
  readonly pdf: Blob;
  readonly diagnostics: readonly ApiDiagnostic[];
}>;

export async function compilePdf(
  request: CompilePdfRequest,
  signal?: AbortSignal,
): Promise<CompilePdfResult> {
  if (!PDF_ENABLED)
    return { ok: false, message: "PDF export is not enabled yet." };
  try {
    const response = await fetch(`${API_URL}/pdf/compile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/pdf",
      },
      body: JSON.stringify(request),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(220000)])
        : AbortSignal.timeout(220000),
    });
    if (!response.ok) {
      const type = (response.headers.get("content-type") ?? "").toLowerCase();
      const isJson =
        type.includes("application/json") || type.includes("+json");
      if (!isJson) {
        if (response.status === 413)
          return { ok: false, message: "Document exceeds 256 KiB." };
        if (
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504
        )
          return {
            ok: false,
            message: `The PDF service failed while compiling this document (HTTP ${String(response.status)}). Try the fast engine or simplify wide tables.`,
          };
        return {
          ok: false,
          message: `Compilation failed (${String(response.status)}).`,
        };
      }
      let payload: { message?: string; diagnostics?: ApiDiagnostic[] };
      try {
        payload = (await response.json()) as {
          message?: string;
          diagnostics?: ApiDiagnostic[];
        };
      } catch {
        return {
          ok: false,
          message: `Compilation failed (${String(response.status)}).`,
        };
      }
      const diagnostics = Array.isArray(payload.diagnostics)
        ? payload.diagnostics
            .filter(
              (entry) =>
                typeof entry.code === "string" &&
                typeof entry.message === "string",
            )
            .slice(0, 30)
        : [];
      const retry = response.headers.get("retry-after");
      return {
        ok: false,
        diagnostics,
        message:
          (payload.message ??
            `Compilation failed (${String(response.status)}).`) +
          (retry ? ` Retry in ${retry} seconds.` : "") +
          (diagnostics.length
            ? " " +
              diagnostics
                .map(
                  (entry) =>
                    `${entry.code}${entry.blockIndex === undefined ? "" : ` (block ${String(entry.blockIndex + 1)})`}: ${entry.message}`,
                )
                .join(" ")
            : ""),
      };
    }
    if (!response.headers.get("content-type")?.startsWith("application/pdf"))
      return {
        ok: false,
        message: "The API returned an invalid PDF response.",
      };
    const pdf = await response.blob();
    const bytes = new Uint8Array(await pdf.slice(0, 5).arrayBuffer());
    if (new TextDecoder().decode(bytes) !== "%PDF-")
      return { ok: false, message: "The API returned an invalid PDF." };
    let diagnostics: { code: string; message: string }[] = [];
    try {
      const encoded = response.headers.get("x-publisle-diagnostics");
      if (encoded)
        diagnostics = JSON.parse(
          new TextDecoder().decode(
            Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)),
          ),
        ) as { code: string; message: string }[];
    } catch {
      /* A missing warning header does not invalidate a PDF. */
    }
    return { ok: true, value: { pdf, diagnostics } };
  } catch (cause) {
    return {
      ok: false,
      message: signal?.aborted
        ? "PDF export cancelled."
        : cause instanceof Error && cause.name === "TimeoutError"
          ? "PDF compilation exceeded its time limit."
          : "Could not reach the PDF service.",
    };
  }
}

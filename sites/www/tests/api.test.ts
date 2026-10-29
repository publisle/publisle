import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function compile(response: Response) {
  vi.resetModules();
  vi.stubEnv("PUBLIC_PDF_ENABLED", "true");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response)),
  );
  const { compilePdf } = await import("../src/lib/api.ts");
  return compilePdf({ template: "article", markdown: "token00" });
}

describe("PDF compile errors", () => {
  it("maps non-JSON gateway failures without parsing the body", async () => {
    const html = (status: number) =>
      new Response("<html>edge error</html>", {
        status,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    await expect(compile(html(413))).resolves.toEqual({
      ok: false,
      message: "Document exceeds 256 KiB.",
    });
    for (const status of [502, 503, 504])
      await expect(compile(html(status))).resolves.toEqual({
        ok: false,
        message: `The PDF service failed while compiling this document (HTTP ${String(status)}). Try the fast engine or simplify wide tables.`,
      });
    await expect(compile(html(500))).resolves.toEqual({
      ok: false,
      message: "Compilation failed (500).",
    });
  });

  it("reads a JSON error body, including diagnostics", async () => {
    const result = await compile(
      new Response(
        JSON.stringify({
          message: "The table is wider than the page.",
          diagnostics: [
            {
              code: "layout-overflow",
              message: "Overfull line",
              blockIndex: 1,
            },
          ],
        }),
        {
          status: 422,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "retry-after": "60",
          },
        },
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("The table is wider than the page.");
    expect(result.message).toContain("Retry in 60 seconds.");
    expect(result.message).toContain(
      "layout-overflow (block 2): Overfull line",
    );
    expect(result.diagnostics).toEqual([
      { code: "layout-overflow", message: "Overfull line", blockIndex: 1 },
    ]);
  });
});

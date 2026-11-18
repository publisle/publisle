import { readFileSync } from "node:fs";
import { join } from "node:path";
import { handleRpc } from "@publisle/mcp";
import { describe, expect, it } from "vitest";
import {
  abbreviate,
  DEFAULT_INPUTS,
  runSession,
  type Transport,
  type TranscriptEntry,
} from "../src/lib/mcp-demo";

const site = join(import.meta.dirname, "..");

function transport(withPdf: boolean): Transport {
  return {
    name: withPdf ? "hosted" : "browser",
    send: async (message) => {
      const outcome = await handleRpc(
        message,
        withPdf
          ? {
              host: {
                templates: () => [],
                compilePdf: () =>
                  Promise.resolve({
                    pdf: new TextEncoder().encode("%PDF-1.7 demo"),
                    diagnostics: [],
                  }),
              },
            }
          : {},
      );
      if (outcome.kind === "none") return { status: 202, body: undefined };
      return {
        status: 200,
        body: outcome.kind === "single" ? outcome.response : outcome.responses,
      };
    },
  };
}

async function session(withPdf: boolean) {
  const entries: TranscriptEntry[] = [];
  const result = await runSession(transport(withPdf), DEFAULT_INPUTS, (entry) =>
    entries.push(entry),
  );
  return { entries, result };
}

describe("MCP demo session", () => {
  it("runs the whole protocol against the real handler and returns a PDF", async () => {
    const { entries, result } = await session(true);
    expect(entries.map((entry) => entry.label)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "new_document",
      "add_block (heading)",
      "add_block (paragraph)",
      "add_block (math)",
      "validate",
      "render_html",
      "compile_pdf",
    ]);
    expect(entries.filter((entry) => !entry.ok)).toEqual([]);
    const notification = entries[1];
    expect(notification.status).toBe(202);
    expect(notification.response).toBeUndefined();
    expect(entries[7]?.summary).toMatch(/^Valid: 3 blocks/u);
    expect(result.html).toContain(DEFAULT_INPUTS.title);
    expect(result.html).toContain("katex");
    expect((result.document as { blocks: unknown[] }).blocks).toHaveLength(3);
    expect(result.pdf?.type).toBe("application/pdf");
    expect(await result.pdf?.text()).toBe("%PDF-1.7 demo");
  });

  it("shows PDF export as a tool error, without stopping, when no compiler is attached", async () => {
    const { entries, result } = await session(false);
    expect(entries).toHaveLength(10);
    const last = entries.at(-1);
    expect(last?.ok).toBe(false);
    expect(last?.summary).toContain("not available");
    expect(result.pdf).toBeUndefined();
    expect(result.html).toBeDefined();
  });

  it("stops at a protocol failure", async () => {
    const entries: TranscriptEntry[] = [];
    await runSession(
      {
        name: "hosted",
        send: () => Promise.reject(new Error("network down")),
      },
      DEFAULT_INPUTS,
      (entry) => entries.push(entry),
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ ok: false });
    expect(entries[0]?.summary).toContain("network down");
  });

  it("shortens long strings and base64 blobs for display", () => {
    const shown = abbreviate({
      html: "x".repeat(1000),
      resource: { blob: "A".repeat(400) },
    });
    expect(shown).toContain("more characters");
    expect(shown).toContain("bytes, base64");
    expect(shown.length).toBeLessThan(700);
  });
});

describe("MCP page wiring", () => {
  it("is linked from the header, the mobile menu and the docs", () => {
    expect(
      readFileSync(join(site, "src/layouts/BaseLayout.astro"), "utf8"),
    ).toContain('href: "/mcp/"');
    expect(
      readFileSync(join(site, "src/components/MobileNav.svelte"), "utf8"),
    ).toContain('href: "/mcp/"');
    expect(readFileSync(join(site, "src/pages/mcp.astro"), "utf8")).toContain(
      "/docs/guides/mcp/",
    );
  });

  it("allows the demo to show its PDF without widening other directives", () => {
    const config = readFileSync(join(site, "astro.config.ts"), "utf8");
    expect(config).toContain("frame-src 'self' blob:");
    expect(config).toContain("object-src 'none'");
  });
});

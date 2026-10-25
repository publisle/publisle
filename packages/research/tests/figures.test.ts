import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { document, createBlock } from "@publisle/schema";
import { createLatexPackage } from "../src/package.ts";
import { fetchFigureAsset } from "../src/remote.ts";

const PNG = Buffer.concat([
  Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000002000000020806000000f4785495",
    "hex",
  ),
  Buffer.from(
    "0000000b49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082",
    "hex",
  ),
]);
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4" fill="#123456"/></svg>';
const ACTIVE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><script type="text/javascript">void 0;</script><rect width="4" height="4"/></svg>';

let server: Server;
const bodies = new Map<string, { body: Buffer | string; type: string }>();

beforeAll(async () => {
  server = createServer((request, response) => {
    const entry = bodies.get(request.url ?? "/");
    if (!entry) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": entry.type });
    response.end(entry.body);
  });
  await new Promise<void>((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
});

afterAll(() => {
  server.close();
});

/** A fetch that keeps the https URL identity but serves the local fixture. */
const localFetch: typeof globalThis.fetch = (input) => {
  const path =
    typeof input === "string"
      ? new URL(input).pathname
      : input instanceof URL
        ? input.pathname
        : new URL(input.url).pathname;
  const entry = bodies.get(path);
  if (!entry) return Promise.resolve(new Response("missing", { status: 404 }));
  return Promise.resolve(
    new Response(entry.body as BodyInit, {
      status: 200,
      headers: { "content-type": entry.type },
    }),
  );
};

function figureDocument(src: string) {
  return document({
    metadata: {
      title: "Remote figures",
      language: "en",
      authors: [{ name: "Test Author" }],
    },
    blocks: [
      createBlock({
        type: "publisle:paragraph",
        data: { content: [{ type: "text", value: "Before." }] },
      }),
      createBlock({ type: "publisle:figure", data: { src, alt: "A figure" } }),
    ],
  });
}

describe("remote figure assets", () => {
  it("fetches a PNG figure with service safety rules", async () => {
    bodies.set("/chart.png", { body: PNG, type: "image/png" });
    const figure = await fetchFigureAsset("https://example.com/chart.png", {
      fetch: localFetch,
    });
    expect(figure.extension).toBe("png");
    expect(figure.bytes[0]).toBe(0x89);
  });

  it("rasterizes a self-contained SVG figure to PNG", async () => {
    bodies.set("/picture.svg", { body: SVG, type: "image/svg+xml" });
    const figure = await fetchFigureAsset("https://example.com/picture.svg", {
      fetch: localFetch,
    });
    expect(figure.extension).toBe("png");
    expect(figure.bytes[1]).toBe(0x50);
  });

  it("rejects active SVG content", async () => {
    bodies.set("/evil.svg", { body: ACTIVE_SVG, type: "image/svg+xml" });
    await expect(
      fetchFigureAsset("https://example.com/evil.svg", { fetch: localFetch }),
    ).rejects.toThrow(/self-contained/);
  });

  it("rejects non-HTTPS sources and unsupported content types", async () => {
    await expect(
      fetchFigureAsset("http://example.com/chart.png", { fetch: localFetch }),
    ).rejects.toThrow(/HTTPS/);
    bodies.set("/notes.txt", { body: "hello", type: "text/plain" });
    await expect(
      fetchFigureAsset("https://example.com/notes.txt", { fetch: localFetch }),
    ).rejects.toThrow(/content type/);
  });

  it("rejects oversized figures at the service cap", async () => {
    bodies.set("/huge.png", {
      body: Buffer.alloc(4 * 1024 * 1024 + 1),
      type: "image/png",
    });
    await expect(
      fetchFigureAsset("https://example.com/huge.png", { fetch: localFetch }),
    ).rejects.toThrow(/exceeds 4 MiB/);
  });

  it("projects HTTPS figures into the package and keeps local rejections", () => {
    bodies.set("/paper-plot.png", { body: PNG, type: "image/png" });
    const remote = createLatexPackage(
      figureDocument("https://example.com/paper-plot.png"),
    );
    expect(remote.assets).toEqual([
      {
        source: "https://example.com/paper-plot.png",
        destination: "assets/figure-1.png",
      },
    ]);
    const tex = remote.files["manuscript.tex"] ?? "";
    expect(tex).toContain("assets/figure-1.png");

    expect(() =>
      createLatexPackage(figureDocument("http://example.com/x.png")),
    ).toThrow(/HTTPS/);
    expect(() =>
      createLatexPackage(figureDocument("ftp://example.com/x.png")),
    ).toThrow(/HTTPS/);
    expect(() =>
      createLatexPackage(figureDocument("https://example.com/no-extension")),
    ).toThrow(/must end in PDF, PNG, JPEG or SVG/);
    expect(() =>
      createLatexPackage(figureDocument("./local-only.tiff")),
    ).toThrow(/Unsupported figure asset/);
  });
});

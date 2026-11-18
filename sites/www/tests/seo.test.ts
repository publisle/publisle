// SEO hygiene guard: every site page needs a unique, informative title and
// meta description. Static pages declare both on BaseLayout; documentation
// pages derive them from their first heading and paragraph.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const site = join(import.meta.dirname, "..");

describe("site SEO metadata", () => {
  it("every page declares a unique title and description", () => {
    const seen = new Map<string, string>();
    const pages = readdirSync(join(site, "src/pages"), {
      recursive: true,
    }).filter(
      (name) =>
        typeof name === "string" &&
        name.endsWith(".astro") &&
        // Dynamic routes take titles from the docs collection (tested above).
        !name.includes("["),
    ) as string[];
    for (const name of pages) {
      const source = readFileSync(join(site, "src/pages", name), "utf8");
      for (const field of ["title", "description"] as const) {
        const value = new RegExp(`${field}="([^"]+)"`).exec(source)?.[1];
        expect(value, `${name} is missing ${field}`).toBeTruthy();
        expect(
          seen.has(`${field}:${value ?? ""}`),
          `duplicate ${field} "${value ?? ""}" in ${name} and ${seen.get(`${field}:${value ?? ""}`) ?? ""}`,
        ).toBe(false);
        seen.set(`${field}:${value ?? ""}`, name);
      }
    }
  });

  it("documentation uses its actual unique metadata and social image", async () => {
    const { docSources } = await import("../src/lib/docs-source.ts");
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const doc of docSources()) {
      expect(titles.has(doc.title), doc.id).toBe(false);
      expect(descriptions.has(doc.description), doc.id).toBe(false);
      expect(doc.description.length, doc.id).toBeGreaterThanOrEqual(80);
      expect(doc.description.length, doc.id).toBeLessThanOrEqual(160);
      expect(doc.description, doc.id).not.toMatch(/…$|\.\.\.$/u);
      // Reader tabs and search results truncate near 60 characters.
      expect(`${doc.title} · Publisle Docs`.length, doc.id).toBeLessThanOrEqual(
        60,
      );
      titles.add(doc.title);
      descriptions.add(doc.description);
      const image = readFileSync(join(site, "public/og/docs", `${doc.id}.png`));
      expect(image.subarray(1, 4).toString()).toBe("PNG");
    }
    const route = readFileSync(
      join(site, "src/pages/docs/[...slug].astro"),
      "utf8",
    );
    expect(route).toContain("image={`/og/docs/${entry.id}.png`}");
  });

  it("canonical page paths carry a trailing slash", () => {
    const pages = readdirSync(join(site, "src/pages"), {
      recursive: true,
    }).filter(
      (name) => typeof name === "string" && name.endsWith(".astro"),
    ) as string[];
    for (const name of pages) {
      const source = readFileSync(join(site, "src/pages", name), "utf8");
      const paths = [...source.matchAll(/path=\{?"([^"]*)"/gu)].map(
        (match) => match[1],
      );
      for (const path of paths) {
        expect(
          path.endsWith("/"),
          `${name} canonical path "${path}" is missing a trailing slash`,
        ).toBe(true);
      }
    }
  });

  it("favicon, manifests, and sitemap links resolve to shipped files", async () => {
    // Browsers and SEO auditors request these by name; GitHub Pages has no
    // redirects, so each must exist as a real static file.
    const favicon = readFileSync(join(site, "public/favicon.ico"));
    expect(favicon.subarray(0, 4).toString("hex")).toBe("00000100");
    const manifests = [
      "manifest.webmanifest",
      "manifest.json",
      "site.webmanifest",
    ];
    const contents = manifests.map((name) =>
      readFileSync(join(site, "public", name), "utf8"),
    );
    for (const content of contents) expect(content).toEqual(contents[0]);
    JSON.parse(contents[0] ?? "");

    const layout = readFileSync(
      join(site, "src/layouts/BaseLayout.astro"),
      "utf8",
    );
    expect(layout).toContain(
      '<link rel="manifest" href="/manifest.webmanifest" />',
    );
    expect(layout).toContain('<link rel="sitemap" href="/sitemap.xml" />');
    expect(layout).not.toContain("sitemap-index");
    expect(readFileSync(join(site, "public/robots.txt"), "utf8")).toContain(
      "Sitemap: https://publisle.xyz/sitemap.xml",
    );

    const { sitemapRoutes } = await import("../src/pages/sitemap.xml.ts");
    const { docSources } = await import("../src/lib/docs-source.ts");
    const routes = sitemapRoutes();
    expect(routes).toEqual([
      "/",
      "/docs/",
      "/examples/",
      "/playground/",
      "/mcp/",
      ...docSources().map((doc) => `/docs/${doc.id}/`),
    ]);
    for (const route of routes) {
      expect(route.endsWith("/"), route).toBe(true);
    }
  });
});

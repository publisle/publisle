// Single canonical sitemap. The previous
// @astrojs/sitemap integration only emitted /sitemap-index.xml + /sitemap-0.xml,
// so tools that request /sitemap.xml got a 404. This prerendered endpoint
// enumerates every public route itself and serves them all at /sitemap.xml.
// 404 is deliberately excluded; page URLs carry trailing slashes, matching
// the canonical tags.
import { docSources } from "../lib/docs-source";

export const prerender = true;

/** Every indexable route path, with trailing slashes. */
export function sitemapRoutes(): readonly string[] {
  const routes = ["/", "/docs/", "/examples/", "/playground/", "/mcp/"];
  for (const doc of docSources()) routes.push(`/docs/${doc.id}/`);
  return routes;
}

export function GET(): Response {
  const site = "https://publisle.xyz";
  const urls = sitemapRoutes()
    .map((path) => `\t<url><loc>${site}${path}</loc></url>`)
    .join("\n");
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
  return new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}

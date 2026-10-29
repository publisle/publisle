import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "astro/config";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";
import { publisleAstro } from "@publisle/adapter-astro";

export default defineConfig({
  site: "https://publisle.xyz",
  output: "static",
  trailingSlash: "always",
  security: {
    csp: {
      directives: [
        "default-src 'self'",
        "base-uri 'self'",
        "object-src 'none'",
        // frame-ancestors is ignored in a meta policy and logs a console error.
        "form-action 'self'",
        "connect-src 'self' https://api.publisle.xyz",
        "img-src 'self' data: blob:",
        // KaTeX ships some faces as data: URLs inside its stylesheet.
        "font-src 'self' data:",
        "frame-src 'self' https://www.youtube-nocookie.com https://player.vimeo.com",
        "worker-src 'self' blob:",
        "manifest-src 'self'",
      ],
      // KaTeX and embed iframes set style attributes. Astro still hashes
      // style elements; this only allows those attributes.
      styleDirective: {
        resources: [{ resource: "'unsafe-inline'", kind: "attribute" }],
      },
    },
  },
  integrations: [svelte(), publisleAstro()],
  vite: {
    plugins: [
      tailwindcss(),
      ...(process.env.BUNDLE_REPORT
        ? [
            visualizer({
              filename: process.env.BUNDLE_REPORT,
              template: "raw-data",
              gzipSize: true,
              sourcemap: true,
            }),
          ]
        : []),
    ],
    build: { sourcemap: !!process.env.BUNDLE_REPORT },
  },
});

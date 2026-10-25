import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { createApi } from "../server.mjs";
import { LIMITS } from "../limits.mjs";
import { createRegistry, prepare } from "../../../packages/core/src/index.ts";
import {
  coreBlockDefinitions,
  paragraph,
  figure,
} from "../../../blocks/core/src/index.ts";
import { document as makeDocument } from "../../../packages/schema/src/index.ts";
import {
  compilePublication,
  instantiatePublication,
} from "../../../packages/adapter-core/src/index.ts";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "../../..");
test(
  "website exports current editor data through the real PDF backend",
  { skip: !process.env.PDF_TEST_WORKER_IMAGE, timeout: 300000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "pdf-browser-test-"));
    const api = createApi({
      ready: true,
      image: process.env.PDF_TEST_WORKER_IMAGE,
      ...(process.env.PDF_TEST_NATIVE_WORKER_IMAGE
        ? {
            nativeImage: process.env.PDF_TEST_NATIVE_WORKER_IMAGE,
            nativeTemplates: ["article"],
          }
        : {}),
      assetBase: "https://publisle.xyz/",
      origins: ["http://127.0.0.1"],
      limits: { ...LIMITS, attempts: 30 },
    });
    api.server.listen(0, "127.0.0.1");
    await once(api.server, "listening");
    const apiUrl = `http://127.0.0.1:${api.server.address().port}`;
    const types = {
      ".html": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
    };
    const server = createServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      const path = resolve(
        root,
        "sites/www/dist",
        `.${pathname}`,
        ...(extname(pathname) ? [] : ["index.html"]),
      );
      if (!path.startsWith(join(root, "sites/www/dist/"))) {
        response.writeHead(404);
        response.end();
        return;
      }
      void readFile(path).then(
        (body) => {
          response.setHeader(
            "content-type",
            types[extname(path)] ?? "application/octet-stream",
          );
          response.end(body);
        },
        () => {
          response.writeHead(404);
          response.end();
        },
      );
    });
    let browser;
    try {
      await execute("pnpm", ["--filter", "@publisle/www", "build"], {
        cwd: root,
        env: {
          ...process.env,
          PUBLIC_PDF_ENABLED: "true",
          PUBLIC_API_URL: apiUrl,
        },
        maxBuffer: 4 * 1024 * 1024,
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const siteUrl = `http://127.0.0.1:${server.address().port}`;
      // Test-only exact-origin registration; production retains its fixed allowlist.
      const originalUrl = new URL(apiUrl);
      browser = await chromium.launch({
        executablePath:
          process.env.PUBLISLE_BROWSER_PATH ?? "/usr/bin/google-chrome",
        args: ["--no-sandbox"],
      });
      const securityPage = await browser.newPage();
      const prepared = prepare(
        makeDocument({
          blocks: [
            paragraph({
              content: [
                {
                  type: "link",
                  url: "https://example.com/?a=1&b=2",
                  children: [{ type: "text", value: "Safe link" }],
                },
                {
                  type: "link",
                  url: "java\tscript:alert(1)",
                  children: [{ type: "text", value: "Unsafe link" }],
                },
                {
                  type: "link",
                  url: "java\nscript:alert(1)",
                  children: [{ type: "text", value: "Unsafe newline" }],
                },
              ],
            }),
            figure({
              src: "https://example.com/image?a=1&b=2",
              alt: 'A "quote" & image',
              caption: [],
            }),
          ],
        }),
        { registry: createRegistry(coreBlockDefinitions) },
      );
      assert.ok(prepared.document);
      await securityPage.route("https://example.com/**", (route) =>
        route.abort(),
      );
      await securityPage.setContent(
        instantiatePublication(compilePublication(prepared.document), "browser")
          .html,
      );
      assert.equal(await securityPage.locator("a[href]").count(), 1);
      assert.equal(
        await securityPage.locator("a[href]").evaluate((node) => node.href),
        "https://example.com/?a=1&b=2",
      );
      assert.equal(
        await securityPage.locator("img").evaluate((node) => node.src),
        "https://example.com/image?a=1&b=2",
      );
      assert.equal(
        await securityPage.locator("img").getAttribute("alt"),
        'A "quote" & image',
      );
      await securityPage.close();
      const page = await browser.newPage({ acceptDownloads: true });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      // Use a same-origin browser proxy to the actual local API, preserving real
      // HTTP requests and compilation while avoiding an ephemeral CORS origin.
      await page.route(`${apiUrl}/**`, async (route) => {
        const headers = { ...route.request().headers() };
        delete headers.origin;
        // Cold LaTeX compilations legitimately exceed Playwright's default
        // 30 s routing timeout (multi-pass latexmk on a fresh TeX cache).
        const response = await route.fetch({ headers, timeout: 180_000 });
        await route.fulfill({
          response,
          headers: {
            ...response.headers(),
            "access-control-allow-origin": siteUrl,
            "access-control-expose-headers":
              "x-publisle-diagnostics,retry-after",
          },
        });
      });
      await page.goto(`${siteUrl}/playground/`);
      await page.waitForSelector("astro-island[ssr]", { state: "detached" });
      await page.getByText("PDF options", { exact: true }).click();
      await page
        .getByLabel("Paper title", { exact: true })
        .fill("Browser PDF test");
      await page
        .getByLabel("Authors (separated by semicolons)", { exact: true })
        .fill("Ada Example");
      await page
        .getByLabel("PDF layout", { exact: true })
        .selectOption(
          process.env.PDF_TEST_NATIVE_WORKER_IMAGE ? "article" : "ieee-journal",
        );
      const exportButton = page.getByRole("button", {
        name: "Export PDF",
        exact: true,
      });
      await exportButton.waitFor();
      async function download(expectedText) {
        const downloadPromise = page.waitForEvent("download", {
          timeout: 190000,
        });
        await exportButton.click();
        const file = await downloadPromise;
        const path = join(directory, `download-${Date.now()}.pdf`);
        await file.saveAs(path);
        const text = (await execute("pdftotext", [path, "-"])).stdout;
        assert.ok(text.includes(expectedText), text);
      }
      await download("Edit this document");
      await page.getByRole("tab", { name: "markdown", exact: true }).click();
      await page
        .getByRole("textbox", { name: "Markdown source", exact: true })
        .fill(
          "# Updated manuscript\n\nImmediate editor update in the downloaded paper.",
        );
      await download("Immediate editor update");
      await page.getByRole("tab", { name: "json", exact: true }).click();
      const jsonSource = page.getByRole("textbox", {
        name: "Document JSON",
        exact: true,
      });
      const document = JSON.parse(await jsonSource.inputValue());
      document.blocks = [
        {
          id: "018f4e3b-4c5d-7e6f-8a9b-0c1d2e3f4a5b",
          type: "publisle:paragraph",
          schemaVersion: 1,
          data: { content: [{ type: "text", value: "JSON mode manuscript." }] },
        },
      ];
      await jsonSource.fill(JSON.stringify(document));
      await download("JSON mode manuscript.");
      await jsonSource.fill("{");
      await exportButton.click();
      await page
        .getByRole("status")
        .filter({ hasText: "Fix the invalid editor source" })
        .waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
        true,
      );
      assert.deepEqual(errors, []);
      assert.equal(originalUrl.hostname, "127.0.0.1");
    } finally {
      await browser?.close();
      api.shutdown();
      server.closeAllConnections();
      server.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

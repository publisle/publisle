import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, devices, type Browser, type Page } from "playwright-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { playgroundExamples } from "../src/lib/playground-examples";

const siteDirectory = fileURLToPath(new URL("..", import.meta.url));
const contentTypes: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};
let server: Server | undefined;
let browser: Browser | undefined;
let baseUrl: string;
async function waitForPreview(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.locator('[aria-label="Compiled preview"]').getAttribute("aria-busy"),
    )
    .toBe("false");
}

beforeAll(async () => {
  execFileSync("pnpm", ["build"], { cwd: siteDirectory, stdio: "pipe" });
  const dist = resolve(siteDirectory, "dist");
  server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const file = resolve(
      dist,
      `.${pathname}`,
      ...(extname(pathname) ? [] : ["index.html"]),
    );
    void readFile(file).then(
      (body) => {
        response.setHeader(
          "Content-Type",
          contentTypes[extname(file)] ?? "application/octet-stream",
        );
        response.end(body);
      },
      () => {
        response.writeHead(404);
        response.end();
      },
    );
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing test server address");
  baseUrl = `http://127.0.0.1:${String(address.port)}`;
  const { PUBLISLE_BROWSER_PATH, CI } = process.env;
  const executablePath =
    PUBLISLE_BROWSER_PATH ??
    (!CI && existsSync("/usr/bin/google-chrome")
      ? "/usr/bin/google-chrome"
      : undefined);
  browser = await chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox"],
  });
});

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve, reject) => {
    if (!server) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
    server.closeAllConnections();
  });
});

it("compiles all examples live and runs the FFT butterfly", async () => {
  if (!browser) throw new Error("Browser not started");
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://www.youtube-nocookie.com/**", (route) =>
    route.abort(),
  );
  try {
    await page.goto(`${baseUrl}/playground/`);
    await page.waitForSelector("astro-island[ssr]", { state: "detached" });
    await waitForPreview(page);
    await page.getByText(/Example documents ·/).click();
    const preview = page.getByRole("region", { name: "Compiled preview" });
    const editor = page.getByRole("region", { name: "Document editor" });
    expect(await editor.isVisible()).toBe(true);
    expect(await preview.isVisible()).toBe(true);
    // The starter sample carries exportable metadata so the first Export PDF
    // click is never blocked by missing title/authors.
    await page.getByRole("tab", { name: /^markdown$/i }).click();
    expect(
      await page.getByRole("textbox", { name: "Markdown source" }).inputValue(),
    ).toMatch(
      /title: "Hello, Publisle"[\s\S]*authors:\n {2}- name: Ada Example/,
    );
    await page.getByRole("tab", { name: /^blocks$/i }).click();
    const editorBounds = await editor.boundingBox();
    const previewBounds = await preview.boundingBox();
    expect(previewBounds?.x).toBeGreaterThan(
      (editorBounds?.x ?? 0) + (editorBounds?.width ?? 0),
    );
    for (const example of playgroundExamples) {
      await page
        .getByRole("button", { name: new RegExp(`^${example.title}`) })
        .click();
      await expect.poll(() => preview.getAttribute("aria-busy")).toBe("false");
      expect(await preview.innerText()).not.toContain(":::");
      expect(await preview.locator(".publisle-document").count()).toBe(1);
      if (example.id === "fft") {
        expect(await preview.locator("figcaption").count()).toBe(3);
        await preview
          .locator("img")
          .evaluateAll((images: HTMLImageElement[]) =>
            Promise.all(images.map((image) => image.decode())),
          );
        await preview
          .getByRole("button", { name: "Explore Eight-point FFT butterfly" })
          .focus();
        await page.keyboard.press("Enter");
        await preview.getByRole("button", { name: "Step stage" }).click();
        await expect
          .poll(() => preview.locator(".publisle-fft__stage").innerText())
          .toContain("After butterfly stage 1 of 3");
        await preview.getByRole("button", { name: "Run all 3 stages" }).click();
        await expect
          .poll(() => preview.locator(".publisle-fft__stage").innerText())
          .toContain("Output spectrum (DFT)");
        await preview
          .getByRole("button", { name: "Reset", exact: true })
          .click();
        await expect
          .poll(() => preview.locator(".publisle-fft__stage").innerText())
          .toContain("Input, bit-reversed");
      }
    }
    await page.getByRole("button", { name: /^Fourier & FFT/ }).click();
    await page.getByRole("tab", { name: /^markdown$/i }).click();
    const source = page.getByRole("textbox", { name: "Markdown source" });
    await source.fill(`${await source.inputValue()}\nAn edited document.\n`);
    await expect
      .poll(() => preview.innerText())
      .toContain("An edited document.");
    await preview
      .getByRole("button", { name: "Explore Eight-point FFT butterfly" })
      .focus();
    await page.keyboard.press("Space");
    await preview.getByRole("button", { name: "Step stage" }).click();
    await expect
      .poll(() => preview.locator(".publisle-fft__stage").innerText())
      .toContain("After butterfly stage 1 of 3");
    expect(await preview.locator(".publisle-fft__cell").count()).toBe(8);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});

it("saves source and block edits across modes, reloads, and navigation", async () => {
  if (!browser) throw new Error("Browser not started");
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  try {
    await page.goto(`${baseUrl}/playground/?example=fft`);
    await page.waitForSelector("astro-island[ssr]", { state: "detached" });
    await waitForPreview(page);
    expect(new URL(page.url()).searchParams.has("example")).toBe(false);
    expect(
      await page.getByRole("region", { name: "Compiled preview" }).innerText(),
    ).toContain("From Sums to Butterflies");
    await page.getByRole("tab", { name: /^markdown$/i }).click();
    const source = page.getByRole("textbox", { name: "Markdown source" });
    const authored =
      "# Saved draft\n\nContent typed just before switching mode.\n";
    await source.fill(authored);
    await page.getByRole("tab", { name: /^blocks$/i }).click();
    const preview = page.getByRole("region", { name: "Compiled preview" });
    await expect
      .poll(() => preview.innerText())
      .toContain("Content typed just before switching mode.");
    const input = page
      .getByRole("region", { name: "Document editor" })
      .locator(".segment textarea")
      .last();
    expect(await input.getAttribute("aria-label")).toBeTruthy();
    await input.fill("Block edits update while typing.");
    await expect
      .poll(() => preview.innerText())
      .toContain("Block edits update while typing.");
    await page.reload();
    await page.waitForSelector("astro-island[ssr]", { state: "detached" });
    await waitForPreview(page);
    await page.getByRole("tab", { name: /^markdown$/i }).click();
    expect(await source.inputValue()).toContain(
      "Block edits update while typing.",
    );
    await source.fill("# Reloaded draft\n\nSaved without an Import click.\n");
    await page.reload();
    await page.waitForSelector("astro-island[ssr]", { state: "detached" });
    await waitForPreview(page);
    expect(await source.inputValue()).toContain(
      "Saved without an Import click.",
    );
    await expect
      .poll(() => preview.innerText())
      .toContain("Saved without an Import click.");
    await page.getByRole("tab", { name: /^json$/i }).click();
    const json = page.getByRole("textbox", { name: "Document JSON" });
    await json.fill("{ invalid draft");
    await page.reload();
    await page.waitForSelector("astro-island[ssr]", { state: "detached" });
    await waitForPreview(page);
    expect(await json.inputValue()).toBe("{ invalid draft");
    expect(await preview.innerText()).toContain(
      "Saved without an Import click.",
    );
  } finally {
    await page.close();
  }
});

it("persists theme through Astro navigation and searches documentation", async () => {
  if (!browser) throw new Error("Browser not started");
  const page = await browser.newPage();
  try {
    await page.goto(`${baseUrl}/`);
    expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");
    await page.getByRole("link", { name: "Read the docs" }).click();
    await page
      .getByRole("searchbox", { name: "Search all documentation" })
      .fill("accessibility");
    const results = page.getByRole("region", { name: "Documentation search" });
    await expect
      .poll(() => results.getByRole("link").count())
      .toBeGreaterThan(0);
    expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");
    await results.getByRole("link").first().click();
    expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");
    await page.reload();
    expect(await page.locator("html").getAttribute("data-theme")).toBe("dark");
    await page.getByRole("button", { name: "Switch to light theme" }).click();
    await page.reload();
    expect(await page.locator("html").getAttribute("data-theme")).toBe("light");
    await page.getByRole("searchbox").fill("unfindablehippopotamus");
    await expect
      .poll(() =>
        page.getByRole("region", { name: "Documentation search" }).innerText(),
      )
      .toContain("No matching pages");
  } finally {
    await page.close();
  }
});

it("activates the FFT butterfly by touch after opening and restoring the tutorial", async () => {
  if (!browser) throw new Error("Browser not started");
  const context = await browser.newContext({ ...devices["Pixel 5"] });
  const page = await context.newPage();
  try {
    await page.goto(`${baseUrl}/playground/?example=fft`);
    for (let visit = 0; visit < 2; visit += 1) {
      await page.waitForSelector("astro-island[ssr]", { state: "detached" });
      await waitForPreview(page);
      await page.getByRole("tab", { name: /^Preview/ }).tap();
      const preview = page.getByRole("region", { name: "Compiled preview" });
      await waitForPreview(page);
      await preview
        .getByRole("button", { name: "Explore Eight-point FFT butterfly" })
        .tap();
      await preview.getByRole("button", { name: "Step stage" }).tap();
      await expect
        .poll(() => preview.locator(".publisle-fft__stage").innerText())
        .toContain("After butterfly stage 1 of 3");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(393);
      if (visit === 0) await page.reload();
    }
  } finally {
    await context.close();
  }
});

it("contains Quickstart code on mobile and keeps the toolbar above the scrolling editor", async () => {
  if (!browser) throw new Error("Browser not started");
  const page = await browser.newPage();
  try {
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 740 });
      await page.goto(`${baseUrl}/`);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      const codePanels = page.locator(
        "section[aria-labelledby='quickstart'] pre",
      );
      expect(await codePanels.count()).toBe(2);
      for (const panel of await codePanels.all()) {
        const bounds = await panel.boundingBox();
        if (!bounds) throw new Error("Quickstart code is not visible");
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
        if (
          await panel.evaluate(
            (element) => element.scrollWidth > element.clientWidth,
          )
        ) {
          expect(
            await panel.evaluate((element) => {
              element.scrollLeft = 32;
              return element.scrollLeft;
            }),
          ).toBeGreaterThan(0);
        }
      }
      await page.goto(`${baseUrl}/playground/`);
      await page.waitForSelector("astro-island[ssr]", { state: "detached" });
      await waitForPreview(page);
      await page.getByText(/Example documents ·/).click();
      await page.getByRole("button", { name: /^Fourier & FFT/ }).click();
      await page.getByRole("tab", { name: /^blocks$/i }).click();
      const editor = page.getByRole("region", { name: "Document editor" });
      await editor.scrollIntoViewIfNeeded();
      const toolbar = page
        .getByRole("button", { name: "Reset", exact: true })
        .locator("..");
      const toolbarBounds = await toolbar.boundingBox();
      const editorBounds = await editor.boundingBox();
      if (!toolbarBounds || !editorBounds)
        throw new Error("Missing playground layout");
      expect(toolbarBounds.y + toolbarBounds.height).toBeLessThanOrEqual(
        editorBounds.y,
      );
      await editor.evaluate((element) => {
        element.scrollTop = 180;
      });
      expect(
        await editor.evaluate((element) => element.scrollTop),
      ).toBeGreaterThan(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      if (width < 1024) {
        const preview = page.getByRole("region", { name: "Compiled preview" });
        expect(await preview.isVisible()).toBe(false);
        await page.getByRole("tab", { name: /^Preview/ }).click();
        expect(await preview.isVisible()).toBe(true);
        expect(await editor.isVisible()).toBe(false);
        await waitForPreview(page);
        await preview
          .getByRole("button", { name: "Explore Eight-point FFT butterfly" })
          .click();
        await preview.getByRole("button", { name: "Step stage" }).click();
        await expect
          .poll(() => preview.locator(".publisle-fft__stage").innerText())
          .toContain("After butterfly stage 1 of 3");
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBe(width);
        await page.getByRole("tab", { name: "Edit", exact: true }).click();
        await page.getByRole("tab", { name: /^markdown$/i }).click();
        await page
          .getByRole("textbox", { name: "Markdown source" })
          .fill("# Mobile edit\n\nPhone edits survive view changes.");
        await page.getByRole("tab", { name: /^Preview/ }).click();
        await waitForPreview(page);
        expect(await preview.innerText()).toContain(
          "Phone edits survive view changes.",
        );
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBe(width);
      }
    }
  } finally {
    await page.close();
  }
});

it("contains docs code and aligns Research equation numbers on small and large screens", async () => {
  if (!browser) throw new Error("Browser not started");
  const page = await browser.newPage();
  try {
    for (const width of [320, 390, 768, 1280]) {
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${baseUrl}/docs/guides/journal-export/`);
        await page.evaluate((theme) => {
          localStorage.setItem("publisle-theme", theme);
          document.documentElement.dataset.theme = theme;
        }, theme);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBe(width);
        const panels = page.locator(".publisle-document pre");
        expect(await panels.first().innerText()).toContain(
          "npm install -g @publisle/cli",
        );
        for (const panel of await panels.all()) {
          const box = await panel.boundingBox();
          if (!box) continue;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
        }
        await page.goto(`${baseUrl}/playground/?example=research-paper`);
        await page.waitForSelector("astro-island[ssr]", { state: "detached" });
        await waitForPreview(page);
        if (width < 1024)
          await page.getByRole("tab", { name: /^Preview/ }).click();
        await waitForPreview(page);
        const preview = page.getByRole("region", { name: "Compiled preview" });
        expect(await preview.innerText()).not.toMatch(
          /(Equation|Figure|Table) \1 /u,
        );
        const equations = preview.locator(".publisle-math-numbered");
        expect(await equations.count()).toBeGreaterThan(0);
        for (const equation of await equations.all()) {
          const math = await equation
            .locator(":scope > .katex-display")
            .boundingBox();
          const number = await equation
            .locator(".publisle-equation-number")
            .boundingBox();
          if (!math || !number) throw new Error("Missing equation geometry");
          expect(number.x).toBeGreaterThanOrEqual(math.x + math.width);
          expect(
            Math.abs(number.y + number.height / 2 - math.y - math.height / 2),
          ).toBeLessThan(2);
        }
      }
    }
  } finally {
    await page.close();
  }
}, 60000);

it("shows static research content before starting the landing-page experiment", async () => {
  if (!browser) throw new Error("Browser not started");
  const page = await browser.newPage();
  try {
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${baseUrl}/`);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      expect(
        await page.locator(".publisle-math-numbered").count(),
      ).toBeGreaterThan(0);
      expect(await page.locator(".publisle-fft__stage").count()).toBe(0);
    }
    await page
      .getByRole("button", { name: "Explore the FFT butterfly", exact: true })
      .click();
    await page.getByRole("button", { name: "Step stage", exact: true }).click();
    await expect
      .poll(() => page.locator(".publisle-fft__stage").innerText())
      .toContain("After butterfly stage 1 of 3");
  } finally {
    await page.close();
  }
  const staticPage = await browser.newPage({ javaScriptEnabled: false });
  try {
    await staticPage.goto(`${baseUrl}/`);
    expect(
      await staticPage.locator(".publisle-equation-number").innerText(),
    ).toBe("(1)");
    expect(
      await staticPage
        .getByAltText(/output spectrum has magnitude/)
        .isVisible(),
    ).toBe(true);
    expect(
      (
        await staticPage.request.get(`${baseUrl}/examples/research-paper.pdf`)
      ).ok(),
    ).toBe(true);
  } finally {
    await staticPage.close();
  }
});

it("keeps long equations scrollable without displacing their number", async () => {
  if (!browser) throw new Error("Browser not started");
  const page = await browser.newPage({ viewport: { width: 320, height: 900 } });
  try {
    await page.goto(`${baseUrl}/playground/`);
    await page.waitForSelector("astro-island[ssr]", { state: "detached" });
    await waitForPreview(page);
    await page.getByRole("tab", { name: /^Markdown$/i }).click();
    await page
      .getByRole("textbox", { name: "Markdown source" })
      .fill(
        `:::equation{label="eq:long"}\n\n$$\nx=${Array.from({ length: 40 }, (_, i) => `a_${String(i)}`).join("+")}\n$$\n\n:::\n`,
      );
    await page.getByRole("tab", { name: /^Preview/ }).click();
    const math = page.locator(".publisle-math-numbered > .katex-display");
    await expect.poll(() => math.count()).toBe(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(320);
    expect(
      await math.evaluate((el) => {
        el.scrollLeft = 100;
        return el.scrollLeft;
      }),
    ).toBeGreaterThan(0);
    const number = await page
      .locator(".publisle-equation-number")
      .boundingBox();
    if (!number) throw new Error("Missing equation number");
    expect(number.x + number.width).toBeLessThanOrEqual(320);
  } finally {
    await page.close();
  }
});

it("preserves a JSON draft when an older saved Markdown tab has no source text", async () => {
  if (!browser) throw new Error("Browser not started");
  const page = await browser.newPage();
  try {
    await page.addInitScript(() => {
      localStorage.setItem(
        "publisle-draft-v1",
        JSON.stringify({
          version: 1,
          mode: "markdown",
          document: JSON.stringify({
            schemaVersion: 1,
            metadata: { title: "Preserved draft" },
            blocks: [
              {
                id: "543a6f0a-9356-58d8-a60e-27a8e17a0269",
                type: "publisle:paragraph",
                schemaVersion: 1,
                data: {
                  content: [
                    { type: "text", value: "Keep this saved paragraph." },
                  ],
                },
              },
            ],
          }),
        }),
      );
    });
    await page.goto(`${baseUrl}/playground/`);
    await page.waitForSelector("astro-island[ssr]", { state: "detached" });
    await waitForPreview(page);
    await expect
      .poll(() =>
        page.getByRole("textbox", { name: "Markdown source" }).inputValue(),
      )
      .toContain("Keep this saved paragraph.");
    expect(
      await page.getByRole("region", { name: "Compiled preview" }).innerText(),
    ).toContain("Keep this saved paragraph.");
  } finally {
    await page.close();
  }
});

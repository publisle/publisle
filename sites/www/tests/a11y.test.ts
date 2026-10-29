import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const site = join(import.meta.dirname, "..");

describe("site accessibility and CSP", () => {
  it("names the logo link and leaves both lockups unlabeled", () => {
    const layout = readFileSync(
      join(site, "src/layouts/BaseLayout.astro"),
      "utf8",
    );
    expect(layout).toContain('aria-label="Publisle home"');
    expect(layout).toContain(
      'name="referrer" content="strict-origin-when-cross-origin"',
    );
    expect(layout).not.toContain('alt="Publisle"');
    expect(layout).toContain('aria-live="polite"');
    expect(layout).toContain('textContent = "Copy code"');
    expect(layout).toContain('[aria-label="Compiled preview"]');
  });

  it("allows the PDF API in the built-in CSP", () => {
    const config = readFileSync(join(site, "astro.config.ts"), "utf8");
    expect(config).toContain("security:");
    expect(config).toContain("connect-src 'self' https://api.publisle.xyz");
  });
});

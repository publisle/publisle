import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { fromMarkdown } from "../../markdown/src/index.ts";
import { template } from "../../template-article/src/index.ts";
import { createLatexPackage } from "../src/package.ts";
import { compileLatexPackage } from "../src/node.ts";

const headings = Array.from(
  { length: 12 },
  (_, index) => `Aa${String(index + 1).padStart(2, "0")}`,
);

it("keeps a caption-less 12-column LuaLaTeX table from painting cells on top of each other", async () => {
  const parsed = fromMarkdown(`---
title: Wide table
authors:
  - name: Ada
---

| ${headings.join(" | ")} |
| ${headings.map(() => "---").join(" | ")} |
| ${headings.map((_, index) => `v${String(index + 1)}`).join(" | ")} |
`);
  if (!parsed.document) throw new Error("Invalid wide-table fixture");
  const source = createLatexPackage(parsed.document, {
    template,
    engine: "lualatex",
    pdfUa: false,
  });
  const tex = source.files["manuscript.tex"] ?? "";
  expect(tex).toContain("\\begin{tabular}{llllllllllll}");
  expect(tex).not.toContain("\\caption");
  const compiled = await compileLatexPackage(source, {
    compiler: "native",
    sourceDirectory: process.cwd(),
  });
  const directory = await mkdtemp(join(tmpdir(), "publisle-wide-table-"));
  try {
    const path = join(directory, "manuscript.pdf");
    await writeFile(path, compiled.pdf);
    const { stdout } = await promisify(execFile)("pdftotext", [
      "-bbox",
      path,
      "-",
    ]);
    expect(stdout).not.toMatch(/Table\s+\d+:/u);
    const word = (value: string) => {
      const attributes = new RegExp(
        `<word\\b([^>]*)>${value}</word>`,
        "u",
      ).exec(stdout)?.[1];
      if (!attributes) throw new Error(`Missing PDF word: ${value}`);
      const coordinate = (key: string) => {
        const number = new RegExp(`${key}="([0-9.]+)"`, "u").exec(
          attributes,
        )?.[1];
        if (!number) throw new Error(`Missing ${key} for ${value}`);
        return Number(number);
      };
      return { left: coordinate("xMin"), right: coordinate("xMax") };
    };
    for (let index = 0; index < headings.length - 1; index += 1) {
      const current = word(headings[index] ?? "");
      const next = word(headings[index + 1] ?? "");
      expect(current.right).toBeLessThanOrEqual(next.left + 0.5);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

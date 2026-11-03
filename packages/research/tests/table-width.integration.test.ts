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
  (_, index) => `Column heading ${index + 1}`,
);

const markdown = `---
title: Wide table
authors:
  - name: Ada
---

| ${headings.join(" | ")} |
| ${headings.map(() => "---").join(" | ")} |
| ${headings.map((_, index) => `value-${index + 1}`).join(" | ")} |
`;

it("fits a caption-less 12-column table on LuaLaTeX and pdfLaTeX", async () => {
  const parsed = fromMarkdown(markdown);
  if (!parsed.document) throw new Error("Invalid wide-table fixture");
  for (const engine of ["lualatex", "pdflatex"] as const) {
    const source = createLatexPackage(parsed.document, {
      template,
      engine,
      pdfUa: false,
    });
    const tex = source.files["manuscript.tex"] ?? "";
    expect(tex, engine).toContain("\\scriptsize\\setlength{\\tabcolsep}{1.5pt}");
    expect(tex, engine).toContain("\\begin{tabularx}{\\columnwidth}{");
    expect(tex, engine).not.toContain("\\caption");
    const compiled = await compileLatexPackage(source, {
      compiler: "native",
      sourceDirectory: process.cwd(),
    });
    const wide = compiled.diagnostics
      .filter((item) => item.code === "latex-layout-overflow")
      .map((item) => / \(([\d.]+)pt too wide\)/u.exec(item.message)?.[1])
      .filter((value): value is string => value !== undefined)
      .map(Number);
    expect(
      wide.every((points) => points <= 10),
      `${engine} overfull ${wide.join(", ")}`,
    ).toBe(true);
    const directory = await mkdtemp(join(tmpdir(), "publisle-wide-table-"));
    try {
      const path = join(directory, "manuscript.pdf");
      await writeFile(path, compiled.pdf);
      const { stdout } = await promisify(execFile)("pdftotext", [
        "-bbox",
        path,
        "-",
      ]);
      expect(stdout, engine).not.toMatch(/Table\s+\d+:/u);
      const page = /<page\b([^>]*)>/u.exec(stdout)?.[1] ?? "";
      const pageWidth = Number(/width="([0-9.]+)"/u.exec(page)?.[1]);
      expect(pageWidth, engine).toBeGreaterThan(500);
      const rights = [...stdout.matchAll(/xMax="([0-9.]+)"/gu)].map((match) =>
        Number(match[1]),
      );
      expect(Math.max(...rights), engine).toBeLessThanOrEqual(pageWidth - 36);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

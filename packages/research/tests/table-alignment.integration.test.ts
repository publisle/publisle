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

it("renders authored alignment, list starts and nesting in the compiled LaTeX PDF", async () => {
  const parsed = fromMarkdown(`---
title: Structure verification
authors:
  - name: Ada
---

3. Outerone
   - Inneralpha
   - Innerbeta
4. Outertwo

| LHEAD | CHEAD | RHEAD |
| :--- | :---: | ---: |
| L | C | R |
`);
  if (!parsed.document) throw new Error("Invalid structure fixture");
  const source = createLatexPackage(parsed.document, {
    template,
    engine: "lualatex",
    pdfUa: false,
  });
  const compiled = await compileLatexPackage(source, {
    compiler: "native",
    sourceDirectory: process.cwd(),
  });
  const directory = await mkdtemp(join(tmpdir(), "publisle-table-alignment-"));
  try {
    const path = join(directory, "manuscript.pdf");
    await writeFile(path, compiled.pdf);
    const { stdout } = await promisify(execFile)("pdftotext", [
      "-bbox",
      path,
      "-",
    ]);
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
      return {
        left: coordinate("xMin"),
        right: coordinate("xMax"),
        top: coordinate("yMin"),
      };
    };
    expect(word("L").left).toBeCloseTo(word("LHEAD").left, 1);
    expect((word("C").left + word("C").right) / 2).toBeCloseTo(
      (word("CHEAD").left + word("CHEAD").right) / 2,
      1,
    );
    expect(word("R").right).toBeCloseTo(word("RHEAD").right, 1);
    expect(word("3\\.").top).toBeCloseTo(word("Outerone").top, 1);
    expect(word("4\\.").top).toBeCloseTo(word("Outertwo").top, 1);
    for (const value of ["Inneralpha", "Innerbeta"])
      expect(word(value).left).toBeGreaterThan(word("Outerone").left);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

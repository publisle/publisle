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

const execute = promisify(execFile);
const line = Array.from(
  { length: 50 },
  (_, index) => `token${String(index).padStart(2, "0")}`,
).join(" ");

it("keeps a 50-token code line readable in LuaLaTeX and pdfLaTeX PDFs", async () => {
  const parsed = fromMarkdown(`---
title: Long code line
authors:
  - name: Ada
---

\`\`\`
${line}
\`\`\`
`);
  if (!parsed.document) throw new Error("Invalid long-code fixture");
  for (const engine of ["lualatex", "pdflatex"] as const) {
    // Untagged engines. The PDF/UA suite covers the tagged listing hooks.
    const source = createLatexPackage(parsed.document, {
      template,
      engine,
      pdfUa: false,
    });
    const tex = source.files["manuscript.tex"] ?? "";
    expect(tex).toContain("\\begin{lstlisting}[breaklines=true");
    expect(tex).toContain(line);
    const compiled = await compileLatexPackage(source, {
      compiler: "native",
      sourceDirectory: process.cwd(),
    });
    expect(
      compiled.diagnostics.some(
        (item) => item.code === "latex-layout-overflow",
      ),
      engine,
    ).toBe(false);
    const directory = await mkdtemp(join(tmpdir(), "publisle-code-wrap-"));
    try {
      const path = join(directory, "manuscript.pdf");
      await writeFile(path, compiled.pdf);
      const { stdout } = await execute("pdftotext", ["-layout", path, "-"]);
      expect(stdout, engine).toContain("token49");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

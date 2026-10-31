/** Exercise the public default and explicit native engines after activation. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const base = "https://api.publisle.xyz";
const header = (title) =>
  `---\ntitle: ${title}\nlanguage: en\nauthors:\n  - name: Release verification\n---\n\n`;

async function compile(label, markdown, engine) {
  const response = await fetch(`${base}/pdf/compile`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/pdf" },
    body: JSON.stringify({
      markdown,
      template: "article",
      ...(engine ? { engine } : {}),
    }),
    signal: AbortSignal.timeout(60000),
  });
  assert.equal(
    response.status,
    200,
    `Public ${label} compilation failed: ${await (response.ok ? Promise.resolve("") : response.text())}`,
  );
  const pdf = Buffer.from(await response.arrayBuffer());
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  const text = execFileSync("pdftotext", ["-", "-"], {
    input: pdf,
    encoding: "utf8",
    timeout: 10000,
  });
  assert(
    !/[\u25a1\ufffd]/u.test(text),
    `Public ${label} PDF has missing glyphs`,
  );
  const encoded = response.headers.get("x-publisle-diagnostics") ?? "W10=";
  const diagnostics = JSON.parse(Buffer.from(encoded, "base64").toString());
  return { text, diagnostics };
}

for (const engine of [undefined, "rust"]) {
  const label = engine ?? "default";
  const title = `Release verification ${label} ${Date.now()}`;
  const { text } = await compile(
    label,
    `${header(title)}A public PDF compilation verifies the deployed service.\n`,
    engine,
  );
  assert(text.includes(title), `Public ${label} PDF lost its title`);
}

// publisle-pdf 0.6.2 turned a tab into U+FFFD and dropped the rest of the line.
const tabs = await compile(
  "native tab and emoji",
  `${header(`Tabs ${Date.now()}`)}\`\`\`text\nkeyword\tvalue\n\`\`\`\n\nEmoji \u{1F600} stays.\n`,
  "rust",
);
assert.match(tabs.text, /keyword\s+value/u, "Native PDF lost the tab");
assert(tabs.text.includes("\u{1F600}"), "Native PDF lost the emoji");

// The default engine is LaTeX. A code line used to be clipped at the page edge
// (10 of 50 tokens survived) until the worker moved to wrapping listings.
const tokens = Array.from(
  { length: 50 },
  (_, index) => `token${String(index).padStart(2, "0")}`,
);
const code = await compile(
  "default long code line",
  `${header(`Code ${Date.now()}`)}\`\`\`text\n${tokens.join(" ")}\n\`\`\`\n`,
);
const kept = tokens.filter((token) => code.text.includes(token));
assert.equal(
  kept.length,
  tokens.length,
  `LaTeX kept ${kept.length} of 50 tokens`,
);

// publisle-pdf 0.6.3 stops tables shrinking below 0.6 and splits overlong words,
// so a 12-column table compiles natively. It must neither fail nor fall back to
// LuaLaTeX, which overlapped the headers and printed an empty caption.
const row = (cell) =>
  `| ${Array.from({ length: 12 }, (_, index) => cell(index)).join(" | ")} |`;
const table = [
  row((index) => `Column heading ${index + 1}`),
  row(() => "---"),
  row((index) => `value-${index + 1}`),
].join("\n");
const wide = await compile(
  "native 12-column table",
  `${header(`Wide ${Date.now()}`)}${table}\n`,
  "rust",
);
assert(
  !wide.diagnostics.some((entry) => entry.code === "native-engine-fallback"),
  "The 12-column table fell back to LuaLaTeX",
);
console.log(
  "Public default, native, tab, code-line and wide-table compilations passed.",
);

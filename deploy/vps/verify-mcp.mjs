import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { LIMITS } from "./limits.mjs";

const base = process.env.PUBLISLE_PUBLIC_API ?? "https://api.publisle.xyz";
const origin = "https://publisle.xyz";
const deadline = 5_000;
let id = 0;

function post(route, body, requestOrigin = origin) {
  return fetch(new URL(route, base), {
    method: "POST",
    headers: { "content-type": "application/json", origin: requestOrigin },
    body,
    signal: AbortSignal.timeout(10_000),
  });
}

function message(method, params) {
  return JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params });
}

async function decode(response, status) {
  assert.equal(
    response.status,
    status,
    `HTTP ${response.status} from ${response.url}`,
  );
  assert.match(
    response.headers.get("content-type") ?? "",
    /^application\/json\b/u,
  );
  return response.json();
}

const ping = message("ping");
const atCap = ping.padEnd(LIMITS.requestBytes);
const atCapResponse = await decode(await post("/mcp", atCap), 200);
assert.deepEqual(atCapResponse.result, {});

const tooLarge = atCap + " ";
const edgeError = await post("/mcp", tooLarge);
assert.equal(edgeError.headers.get("access-control-allow-origin"), origin);
assert.deepEqual(await decode(edgeError, 413), {
  jsonrpc: "2.0",
  id: null,
  error: { code: -32600, message: "Request exceeds 256 KiB." },
});
const pdfError = await post("/pdf/compile", tooLarge);
assert.equal(pdfError.headers.get("access-control-allow-origin"), origin);
assert.equal((await decode(pdfError, 413)).code, "request-limit");

const denied = await post("/mcp", ping, "https://denied.example");
assert.equal(denied.headers.has("access-control-allow-origin"), false);
assert.deepEqual(await decode(denied, 403), {
  jsonrpc: "2.0",
  id: null,
  error: { code: -32600, message: "Origin is not allowed." },
});

async function call(name, args) {
  const body = message("tools/call", { name, arguments: args });
  assert.ok(Buffer.byteLength(body) <= LIMITS.requestBytes, name);
  const started = performance.now();
  const response = await decode(await post("/mcp", body), 200);
  const ms = Math.round(performance.now() - started);
  assert.ok(response.result, `${name}: ${JSON.stringify(response.error)}`);
  assert.ok(
    !response.result.isError,
    `${name}: ${JSON.stringify(response.result.structuredContent)}`,
  );
  assert.ok(ms < deadline, `${name} took ${ms} ms`);
  return { data: response.result.structuredContent, ms };
}

const sampleText = "مرحبا שלום 中文 🚀 e\u0301";
const ascii =
  "---\ntitle: Small document\nauthors:\n  - name: Writer\n---\n\n# Hello\n\nA short sentence.\n";
const unicode = `---\ntitle: تجربة عربي\nauthors:\n  - name: كاتب\n---\n\n# مرحبا\n\n${sampleText}\n`;
const asciiMs = [];
const unicodeMs = [];
let unicodeDocument;
for (let sample = 0; sample < 4; sample++) {
  const left = await call("import_markdown", { markdown: ascii });
  asciiMs.push(left.ms);
  const right = await call("import_markdown", { markdown: unicode });
  unicodeMs.push(right.ms);
  unicodeDocument = right.data.document;
}
const warmMedian = (values) => values.slice(1).sort((a, b) => a - b)[1];
console.log(
  `Markdown imports in ms, first then warm. ASCII ${asciiMs.join(", ")}. Unicode ${unicodeMs.join(", ")}.`,
);
assert.ok(
  warmMedian(unicodeMs) <= Math.max(1_000, 2 * warmMedian(asciiMs)),
  "Warm Unicode import was slower than ASCII.",
);
assert.equal(
  (await call("validate", { document: unicodeDocument })).data.valid,
  true,
);
assert.ok(
  (await call("render_html", { document: unicodeDocument })).data.html.includes(
    sampleText,
  ),
);

const largeDocument = { schemaVersion: 1, blocks: [] };
let bytes = Buffer.byteLength(JSON.stringify(largeDocument));
while (bytes < 230 * 1024) {
  const block = {
    id: randomUUID(),
    type: "publisle:paragraph",
    schemaVersion: 1,
    data: {
      content: [
        {
          type: "text",
          value: "A paragraph for the hosted acceptance check. ".repeat(4),
        },
      ],
    },
  };
  largeDocument.blocks.push(block);
  bytes += Buffer.byteLength(JSON.stringify(block)) + 1;
}
const validation = await call("validate", { document: largeDocument });
assert.equal(validation.data.valid, true);
assert.equal(validation.data.blockCount, largeDocument.blocks.length);
const rendering = await call("render_html", { document: largeDocument });
assert.ok(
  rendering.data.html.includes("A paragraph for the hosted acceptance check."),
);
console.log(
  `Hosted MCP transport and round trips passed. Large document validated in ${validation.ms} ms and rendered in ${rendering.ms} ms.`,
);

// A small number of HTTP requests checks the per-message quota on the live API.
let limited = false;
for (let batch = 0; batch < 6; batch++) {
  const messages = Array.from({ length: 16 }, () => message("ping"));
  const response = await post("/mcp", `[${messages.join(",")}]`);
  if (response.status === 429) {
    assert.equal(response.headers.get("retry-after"), "60");
    assert.deepEqual(await decode(response, 429), {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32000, message: "Too many MCP requests." },
    });
    limited = true;
    break;
  }
  assert.equal((await decode(response, 200)).length, messages.length);
}
assert.ok(limited, "The public MCP endpoint did not enforce its call quota.");
console.log("Hosted MCP quota returned a retryable HTTP 429 for a batch.");

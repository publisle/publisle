import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import { LIMITS } from "../limits.mjs";
import { createApi } from "../server.mjs";

const root = new URL("../../../", import.meta.url).pathname;
const bundle = join(root, "packages/mcp/dist/mcp.mjs");

function ensureBundle() {
  if (!existsSync(bundle))
    execFileSync(process.execPath, ["build.ts"], {
      cwd: join(root, "packages/mcp"),
      stdio: "pipe",
    });
}

const pdf = Buffer.from("%PDF-1.7\nfixture");
const image = `sha256:${"a".repeat(64)}`;

async function start(options = {}) {
  ensureBundle();
  const api = createApi({
    ready: true,
    nativeImage: image,
    nativeTemplates: ["article"],
    compile: async () => ({ pdf, diagnostics: [] }),
    loadMcp: () => import(pathToFileURL(bundle).href),
    ...options,
  });
  api.server.listen(0, "127.0.0.1");
  await once(api.server, "listening");
  const base = `http://127.0.0.1:${api.server.address().port}`;
  const post = (body, headers = {}, signal) =>
    fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
      signal,
    });
  const rpc = async (method, params, id = 1) =>
    (await post({ jsonrpc: "2.0", id, method, params })).json();
  return { api, base, post, rpc };
}

test("every module the API imports is installed by activation", async () => {
  const script = await readFile(
    join(root, "deploy/vps/activate-release.sh"),
    "utf8",
  );
  const files = script
    .match(/^FILES=\(([^)]*)\)/mu)?.[1]
    ?.split(/\s+/u)
    .filter(Boolean);
  assert.ok(
    files?.includes("server.mjs"),
    "FILES is missing from activate-release.sh",
  );
  const install = await readFile(join(root, "deploy/vps/install.sh"), "utf8");
  const installed = install
    .match(/for FILE in ([^;]*); do/u)?.[1]
    ?.split(/\s+/u)
    .filter(Boolean);
  assert.deepEqual([...(installed ?? [])].sort(), [...files].sort());
  const missing = [];
  for (const file of files) {
    const path = join(root, "deploy/vps", file);
    if (!existsSync(path)) continue; // build outputs such as mcp.mjs
    const source = await readFile(path, "utf8");
    for (const match of source.matchAll(
      /(?:from\s+|import\s*\(\s*)["']\.\/([^"']+\.mjs)["']/gu,
    ))
      if (!files.includes(match[1])) missing.push(`${file} -> ${match[1]}`);
  }
  assert.deepEqual(missing, []);
  const entries = await readdir(join(root, "deploy/vps"));
  assert.ok(entries.includes("activate-release.sh"));
});

test("the release script ships the MCP bundle inside the digested source archive", async () => {
  const script = await readFile(join(root, "deploy/vps/release.sh"), "utf8");
  const build = script.indexOf("@publisle/mcp build");
  const append = script.indexOf("tar --append");
  const digest = script.indexOf("SOURCE_SHA=");
  assert.ok(build > 0 && append > build && digest > append);
});

test("POST /mcp serves the protocol and rejects bad transport usage", async () => {
  const { api, base, post, rpc } = await start();
  try {
    const init = await rpc("initialize", { protocolVersion: "2025-06-18" });
    assert.equal(init.result.protocolVersion, "2025-06-18");
    assert.equal(init.result.serverInfo.name, "publisle");
    const listed = await rpc("tools/list", undefined, 2);
    assert.ok(listed.result.tools.length >= 15);

    const notification = await post({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    assert.equal(notification.status, 202);
    assert.equal(await notification.text(), "");

    assert.equal((await post("{nope")).status, 200);
    assert.equal((await (await post("{nope")).json()).error.code, -32700);

    const get = await fetch(`${base}/mcp`);
    assert.equal(get.status, 405);
    assert.equal(get.headers.get("allow"), "POST, OPTIONS");
    assert.equal(
      (await fetch(`${base}/mcp`, { method: "DELETE" })).status,
      405,
    );

    assert.equal(
      (
        await post(
          { jsonrpc: "2.0", id: 1, method: "ping" },
          { "mcp-protocol-version": "1999-01-01" },
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await post(
          { jsonrpc: "2.0", id: 1, method: "ping" },
          { "mcp-protocol-version": "2025-06-18" },
        )
      ).status,
      200,
    );
    assert.equal(
      (await post("{}", { "content-type": "text/plain" })).status,
      415,
    );
    const oversizeMessage = "Request exceeds 256 KiB.";
    const paddedPing = JSON.stringify({ ...ping, pad: "" });
    const boundary = paddedPing.replace(
      '""',
      JSON.stringify("x".repeat(LIMITS.requestBytes - paddedPing.length)),
    );
    assert.equal(Buffer.byteLength(boundary), LIMITS.requestBytes);
    assert.equal((await post(boundary)).status, 200);
    await assertMcpError(
      await post(boundary + " "),
      413,
      -32600,
      oversizeMessage,
    );
    const chunked = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: Readable.from([boundary, " "]),
      duplex: "half",
    });
    await assertMcpError(chunked, 413, -32600, oversizeMessage);
    const denied = await post(ping, { origin: "https://evil.example" });
    assert.equal(denied.headers.has("access-control-allow-origin"), false);
    await assertMcpError(denied, 403, -32600, "Origin is not allowed.");
    const deniedPdf = await fetch(`${base}/pdf/compile`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    assert.equal(deniedPdf.status, 403);
    assert.equal((await deniedPdf.json()).code, "origin-denied");
    const deniedMalformedPath = await fetch(`${base}//[`, {
      method: "POST",
      headers: { origin: "https://evil.example" },
    });
    assert.equal(deniedMalformedPath.status, 403);
    assert.equal((await deniedMalformedPath.json()).code, "origin-denied");

    const preflight = await fetch(`${base}/mcp`, {
      method: "OPTIONS",
      headers: { origin: "https://publisle.xyz" },
    });
    assert.equal(preflight.status, 204);
    assert.match(
      preflight.headers.get("access-control-allow-headers"),
      /Mcp-Protocol-Version/u,
    );
    assert.ok(
      (await (await fetch(`${base}/`)).json()).endpoints.includes("POST /mcp"),
    );
  } finally {
    api.shutdown();
  }
});

test("compile_pdf uses the Rust engine through the existing quota and cache", async () => {
  let engines = [];
  const { api, rpc } = await start({
    limits: { ...LIMITS, attempts: 1 },
    compile: async (input) => {
      engines.push(input.engine);
      return { pdf, diagnostics: [{ code: "ok", message: "fine" }] };
    },
  });
  const call = (args, id) =>
    rpc("tools/call", { name: "compile_pdf", arguments: args }, id);
  try {
    const templates = await rpc("tools/call", {
      name: "list_templates",
      arguments: {},
    });
    assert.deepEqual(
      templates.result.structuredContent.templates.map(
        (entry) => entry.engines,
      ),
      [["rust"]],
    );
    const first = await call(
      { markdown: "---\ntitle: T\nauthors:\n  - name: A\n---\n\nHi" },
      2,
    );
    assert.equal(first.result.isError, undefined);
    assert.deepEqual(engines, ["rust"]);
    const resource = first.result.content.find(
      (entry) => entry.type === "resource",
    );
    assert.equal(
      Buffer.from(resource.resource.blob, "base64").toString(),
      pdf.toString(),
    );
    const second = await call({ markdown: "Another one" }, 3);
    assert.equal(second.result.isError, true);
    assert.equal(second.result.structuredContent.code, "busy");
    assert.equal(engines.length, 1);
    const unsupported = await call(
      { markdown: "x", template: "ieee-journal" },
      4,
    );
    assert.equal(unsupported.result.isError, true);
    assert.equal(engines.length, 1);
  } finally {
    api.shutdown();
  }
});

test("compile_pdf reports unavailable service as a tool error", async () => {
  const { api, rpc } = await start({ ready: false });
  try {
    const result = await rpc("tools/call", {
      name: "compile_pdf",
      arguments: { markdown: "x" },
    });
    assert.equal(result.result.isError, true);
    assert.equal(result.result.structuredContent.code, "unavailable");
    const edit = await rpc(
      "tools/call",
      { name: "list_blocks", arguments: {} },
      2,
    );
    assert.ok(edit.result.structuredContent.blocks.length > 5);
  } finally {
    api.shutdown();
  }
});

const ping = { jsonrpc: "2.0", id: 1, method: "ping" };

async function assertMcpError(response, status, code, message) {
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), {
    jsonrpc: "2.0",
    id: null,
    error: { code, message },
  });
}

async function assertMcpLimited(response) {
  assert.equal(response.headers.get("retry-after"), "60");
  await assertMcpError(response, 429, -32000, "Too many MCP requests.");
}

test("the production MCP quota rolls across windows and keys by the trusted client", async () => {
  let now = 0;
  const { api, base, post } = await start({ mcpNow: () => now });
  const headers = (index) => ({
    "x-forwarded-for": `192.0.2.${index + 1}, 203.0.113.10`,
  });
  try {
    now = 59_999;
    for (let index = 0; index < 90; index++) {
      const response = await post(ping, headers(index));
      assert.equal(response.status, 200);
      await response.json();
    }
    now = 60_000;
    await assertMcpLimited(await post(ping, headers(90)));
    assert.equal(
      (await post(ping, { "x-forwarded-for": "203.0.113.11" })).status,
      200,
    );
    now = 119_999;
    assert.equal((await post(ping, headers(91))).status, 200);
    const compiled = await fetch(`${base}/pdf/compile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/pdf",
      },
      body: JSON.stringify({
        markdown: "---\ntitle: T\nauthors:\n  - name: A\n---\n\nHi",
      }),
    });
    assert.equal(compiled.status, 200);
  } finally {
    api.shutdown();
  }
});

test(
  "the production cap covers bundle startup and recovers after a disconnect",
  { timeout: 10_000 },
  async () => {
    const loading = Promise.withResolvers();
    const sixArrived = Promise.withResolvers();
    const sixExecuting = Promise.withResolvers();
    const release = Promise.withResolvers();
    const disconnected = Promise.withResolvers();
    const { api, post } = await start({ loadMcp: () => loading.promise });
    let seen = 0;
    let executing = 0;
    api.server.on("request", () => {
      if (++seen === 6) sixArrived.resolve();
    });
    const abort = new AbortController();
    const clients = Array.from({ length: 6 }, (_, id) =>
      post({ ...ping, id }, {}, id === 0 ? abort.signal : undefined).catch(
        (error) => error,
      ),
    );
    const mcp = {
      async handleRpcText(text, { signal }) {
        const { id } = JSON.parse(text);
        if (id < 6) {
          if (++executing === 6) sixExecuting.resolve();
          if (id === 0) {
            await once(signal, "abort");
            disconnected.resolve();
          } else await release.promise;
        }
        return { kind: "single", response: { jsonrpc: "2.0", id, result: {} } };
      },
    };
    try {
      await sixArrived.promise;
      await assertMcpLimited(await post({ ...ping, id: 6 }));
      loading.resolve(mcp);
      await sixExecuting.promise;
      await assertMcpLimited(await post({ ...ping, id: 7 }));
      abort.abort();
      assert.equal((await clients[0]).name, "AbortError");
      await disconnected.promise;
      assert.equal((await post({ ...ping, id: 8 })).status, 200);
      release.resolve();
      for (const response of await Promise.all(clients.slice(1))) {
        assert.equal(response.status, 200);
        await response.json();
      }
    } finally {
      abort.abort();
      loading.resolve(mcp);
      release.resolve();
      api.shutdown();
    }
  },
);

test("a missing or broken MCP bundle only disables /mcp", async () => {
  let attempts = 0;
  const { api, base, post } = await start({
    loadMcp: async () => {
      attempts++;
      throw new Error("Cannot find module './mcp.mjs'");
    },
  });
  try {
    const response = await post({ jsonrpc: "2.0", id: 1, method: "ping" });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.message, "MCP is unavailable.");
    assert.equal(
      (await post({ jsonrpc: "2.0", id: 1, method: "ping" })).status,
      503,
    );
    assert.equal(attempts, 2, "a failed load is retried, not cached");
    assert.equal(
      (await (await fetch(`${base}/health`)).json()).services.pdf,
      true,
    );
    const compiled = await fetch(`${base}/pdf/compile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/pdf",
      },
      body: JSON.stringify({ markdown: "x" }),
    });
    assert.equal(compiled.status, 200);
  } finally {
    api.shutdown();
  }
});

test("every tool runs inside the API's production heap and Node flags", () => {
  ensureBundle();
  const script = `
    import { randomUUID } from "node:crypto";
    const { handleRpc, TOOLS, sampleDocument } = await import(process.argv[1]);
    const paragraph = () => ({
      id: randomUUID(), type: "publisle:paragraph", schemaVersion: 1,
      data: { content: [{ type: "text", value: "Lorem ipsum dolor sit amet. ".repeat(7) }] },
    });
    const big = JSON.parse(JSON.stringify(sampleDocument()));
    while (JSON.stringify(big).length < 200 * 1024) big.blocks.push(paragraph());
    const first = big.blocks[0].id;
    const pdf = { compilePdf: async () => ({ pdf: new Uint8Array(1024), diagnostics: [] }), templates: () => [] };
    const calls = {
      list_blocks: {}, list_templates: {}, new_document: {},
      set_metadata: { document: big, metadata: { title: "T", authors: [{ name: "A" }] } },
      add_block: { document: big, type: "publisle:heading", index: 0 },
      update_block: { document: big, blockId: first, data: { level: 1, content: [{ type: "text", value: "x" }] } },
      remove_block: { document: big, blockId: first },
      move_block: { document: big, blockId: first, direction: "down" },
      duplicate_block: { document: big, blockId: first },
      import_markdown: { markdown: "# Title\\n\\n" + "Some text with $x^2$.\\n\\n".repeat(1000) },
      export_markdown: { document: big },
      import_json: { source: JSON.stringify(big) },
      validate: { document: big }, outline: { document: big }, references: { document: big },
      render_html: { document: big }, compile_pdf: { document: big },
    };
    let id = 0;
    for (const tool of TOOLS) {
      const args = calls[tool.name];
      if (!args) throw new Error("No heap-gate call for " + tool.name);
      const out = await handleRpc({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name: tool.name, arguments: args } }, { host: pdf });
      const result = out.response.result;
      if (result.isError && !["outline", "references"].includes(tool.name))
        throw new Error(tool.name + ": " + JSON.stringify(result.structuredContent).slice(0, 300));
    }
    const heap = process.memoryUsage().heapUsed / 1048576;
    console.log(JSON.stringify({ heapMiB: Math.round(heap) }));
  `;
  const output = execFileSync(
    process.execPath,
    [
      "--jitless",
      "--max-old-space-size=48",
      "--input-type=module",
      "-e",
      script,
      pathToFileURL(bundle).href,
    ],
    { encoding: "utf8", timeout: 120_000, cwd: "/" },
  );
  const { heapMiB } = JSON.parse(output.trim().split("\n").pop());
  assert.ok(heapMiB < 44, `MCP bundle left ${heapMiB} MiB of a 48 MiB heap`);
});

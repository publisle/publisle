import { build } from "esbuild";
import { copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

await mkdir("dist", { recursive: true });
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/mcp.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  minify: true,
  legalComments: "none",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
});

// The API loads this file from /opt/publisle-api, where no workspace or
// node_modules exist. It must import and answer a request on its own.
const smoke = await mkdtemp(join(tmpdir(), "publisle-mcp-bundle-"));
try {
  await copyFile("dist/mcp.mjs", join(smoke, "mcp.mjs"));
  execFileSync(
    process.execPath,
    [
      "--jitless",
      "--max-old-space-size=48",
      "--input-type=module",
      "-e",
      `const { handleRpc } = await import(process.argv[1]);
       const out = await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
       if (out.kind !== "single" || !out.response.result.tools.length) process.exit(1);`,
      pathToFileURL(join(smoke, "mcp.mjs")).href,
    ],
    { timeout: 20000, stdio: "pipe" },
  );
} finally {
  await rm(smoke, { recursive: true, force: true });
}
console.log(`mcp.mjs ${String((await stat("dist/mcp.mjs")).size)} bytes`);

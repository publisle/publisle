/** Pack Research and its workspace dependency closure, then install external native bytes. */
import assert from "node:assert/strict";
import { existsSync, realpathSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, relative, dirname, delimiter } from "node:path";
const root = resolve(import.meta.dirname, "..");
const stage = await mkdtemp(
  join(process.env.RUNNER_TEMP ?? tmpdir(), "publisle-native-consumer-"),
);
const tarballs = join(stage, "tarballs"),
  consumer = join(stage, "consumer");
await mkdir(tarballs);
await mkdir(consumer);
function cliPath(name) {
  if (name === "pnpm" && process.env.PNPM_CLI_PATH)
    return process.env.PNPM_CLI_PATH;
  const files = [];
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    for (const suffix of ["", ".cmd"]) {
      const path = join(directory, name + suffix);
      if (existsSync(path)) files.push(realpathSync(path));
    }
  }
  for (const path of files) {
    const base = dirname(path);
    const candidates = [
      join(
        base,
        `node_modules/${name}/bin/${name === "npm" ? "npm-cli.js" : "pnpm.cjs"}`,
      ),
      join(
        base,
        `../${name}/bin/${name === "npm" ? "npm-cli.js" : "pnpm.cjs"}`,
      ),
      path,
    ];
    for (const candidate of candidates)
      if (
        existsSync(candidate) &&
        /^(?:#![^\n]*node|['"]use strict|\/\*)/u.test(
          readFileSync(candidate, "utf8"),
        )
      )
        return candidate;
  }
  throw new Error(
    `Cannot locate ${name} JavaScript CLI; set PNPM_CLI_PATH for pnpm.`,
  );
}
const run = (command, args, cwd = root) => {
  // Use the pnpm already selected on PATH. Resolving the shim to its
  // node_modules copy can execute the action's bootstrap pnpm, which then
  // refuses to switch to the pinned version.
  if (command === "npm") {
    args = [cliPath(command), ...args];
    command = process.execPath;
  }
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 16 * 1024 * 1024,
    shell: command === "pnpm" && process.platform === "win32",
  }).trim();
};
const manifests = new Map();
for (const group of ["packages", "blocks"]) {
  for (const entry of await readdir(join(root, group), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, group, entry.name);
    const manifest = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    );
    if (manifest.publishConfig)
      manifests.set(manifest.name, { directory, manifest });
  }
}
const selected = new Set();
function include(name) {
  if (selected.has(name)) return;
  const item = manifests.get(name);
  assert(item, name);
  selected.add(name);
  for (const dependency of Object.keys(item.manifest.dependencies ?? {}))
    if (manifests.has(dependency)) include(dependency);
}
include("@publisle/research");
for (const name of selected)
  run(
    "pnpm",
    ["pack", "--pack-destination", tarballs],
    manifests.get(name).directory,
  );
await writeFile(
  join(consumer, "package.json"),
  JSON.stringify({ private: true, type: "module" }),
);
run(
  "npm",
  [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    ...(await readdir(tarballs))
      .filter((f) => f.endsWith(".tgz"))
      .map((f) => join(tarballs, f)),
  ],
  consumer,
);
const source = JSON.parse(
  await readFile(join(root, "packages/research/package.json"), "utf8"),
);
const expected =
  source.optionalDependencies[
    `@publisle/pdf-native-${process.platform}-${process.arch}`
  ];
assert(expected);
await writeFile(
  join(consumer, "proof.mjs"),
  `
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {exportPdf} from '@publisle/research/node';
import {document as createDocument,createBlock} from '@publisle/schema';
const require=createRequire(import.meta.url);
const name='@publisle/pdf-native-'+process.platform+'-'+process.arch;
const manifest=JSON.parse(await readFile(require.resolve(name+'/package.json'),'utf8'));
assert.equal(manifest.version,${JSON.stringify(expected)});
assert.equal(manifest.repository.url,'git+https://github.com/publisle/publisle-rs.git');
const root=dirname(require.resolve(name+'/package.json'));
assert(!root.includes('native/packages'), 'Native package must come from the registry');
const document=createDocument({metadata:{title:'External native Research proof',language:'en',authors:[{name:'Ada'}]},blocks:[createBlock({type:'publisle:paragraph',data:{content:[{type:'text',value:'Research uses an independently versioned compiler.'}]}})]});
delete process.env.PUBLISLE_NATIVE_COMPILER; delete process.env.PUBLISLE_NATIVE_FONTS; process.env.PATH='';
const result=await exportPdf(document,{engine:'rust',sourceDirectory:process.cwd()});
assert.equal(result.compilerVersion,manifest.version); assert(result.pdf.length>1000); assert.equal(Buffer.from(result.pdf).subarray(0,5).toString(),'%PDF-');
await writeFile('native-consumer-proof.pdf',result.pdf);
console.log(JSON.stringify({platform:process.platform,architecture:process.arch,compilerVersion:manifest.version,bytes:result.pdf.length}));
`,
);
console.log(run(process.execPath, ["proof.mjs"], consumer));
console.log(
  `Native Research consumer proof retained at ${relative(root, consumer)}`,
);

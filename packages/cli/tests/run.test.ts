import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  link,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../src/run.ts";

const host = fileURLToPath(new URL("./fixtures/host.ts", import.meta.url));
const policy = fileURLToPath(new URL("./fixtures/policy.ts", import.meta.url));
const bin = fileURLToPath(new URL("../src/bin.ts", import.meta.url));
const legacy =
  '{"schemaVersion":1,"blocks":[{"id":"00000000-0000-4000-a000-000000000001","type":"demo:notice","schemaVersion":1,"data":{"text":"Legacy"}}]}';

describe("Node CLI safety and entrypoint", () => {
  let directory: string;
  let file: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "publisle-cli-test-"));
    file = join(directory, "article.json");
    await writeFile(file, legacy);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function invoke(args: string[]) {
    let stdout = "";
    let stderr = "";
    const code = await runCli(args, {
      stdout: (text) => {
        stdout += text;
      },
      stderr: (text) => {
        stderr += text;
      },
    });
    return { code, stdout, stderr };
  }

  // Repeated sealed-schema verification runs alongside the full worker suite, not a performance benchmark.
  it("inspects/exports JSON without executable host config and leaves source untouched", async () => {
    const original = await readFile(file, "utf8");
    for (const command of ["inspect", "semantic", "reading"]) {
      const result = await invoke([command, file]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain(
        command === "reading" ? "Structured details omitted" : "unresolved",
      );
      expect((await invoke([command, file, "--config", host])).code).toBe(2);
    }
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("locks canonical source explicitly without replacing it or overwriting outputs", async () => {
    const source =
      '{"schemaVersion":1,"blocks":[{"id":"00000000-0000-4000-a000-000000000001","type":"publisle:paragraph","schemaVersion":1,"data":{"content":[{"type":"text","value":"Hello"}]}}]}';
    await writeFile(file, source);
    const preview = await invoke(["lock", file]);
    expect(preview.code).toBe(0);
    expect(JSON.parse(preview.stdout)).toHaveProperty(
      "dependencies.0.type",
      "publisle:paragraph",
    );
    expect(await readFile(file, "utf8")).toBe(source);
    const output = join(directory, "locked.json");
    expect((await invoke(["lock", file, "--output", output])).code).toBe(0);
    expect((await invoke(["lock", file, "--output", output])).code).toBe(2);
    expect((await invoke(["lock", file, "--in-place"])).code).toBe(2);
    expect(await readFile(file, "utf8")).toBe(source);
  }, 15000);

  it("rejects invalid UTF-8 without replacing source bytes", async () => {
    const bytes = new Uint8Array([0xc3, 0x28]);
    await writeFile(file, bytes);
    const result = await invoke(["upgrade", file, "--in-place"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("invalid-json-unicode");
    expect(result.stdout).toBe("");
    expect(new Uint8Array(await readFile(file))).toEqual(bytes);
  });

  it("rejects duplicate JSON names before an in-place upgrade can write", async () => {
    const duplicate = '{"schemaVersion":1,"schemaVersion":1,"blocks":[]}';
    await writeFile(file, duplicate);
    const result = await invoke(["upgrade", file, "--in-place"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("duplicate-json-member");
    expect(await readFile(file, "utf8")).toBe(duplicate);
  });

  it("loads explicit TS host config and validates without changing source bytes", async () => {
    const result = await invoke(["validate", file, "--config", host]);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(": valid");
    expect(await readFile(file, "utf8")).toBe(legacy);
    expect(await readdir(directory)).toEqual(["article.json"]);
  });

  it("previews upgraded source on stdout without incidental writes", async () => {
    const result = await invoke(["upgrade", file, "--config", host]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('"message": "Legacy"');
    expect(await readFile(file, "utf8")).toBe(legacy);
    expect(await readdir(directory)).toEqual(["article.json"]);
  });

  it("creates an explicit output and refuses to overwrite existing files", async () => {
    const target = join(directory, "upgraded.json");
    expect(
      (await invoke(["upgrade", file, "--config", host, "--output", target]))
        .code,
    ).toBe(0);
    const before = await readFile(target, "utf8");
    expect(before).toContain('"message": "Legacy"');
    expect(
      (await invoke(["upgrade", file, "--config", host, "--output", target]))
        .code,
    ).toBe(2);
    expect(await readFile(target, "utf8")).toBe(before);
    expect(await readFile(file, "utf8")).toBe(legacy);
    expect((await invoke(["upgrade", file, "--output", file])).code).toBe(2);
  });

  it("requires deliberate in-place authorization and atomically replaces only successful upgrades", async () => {
    const mode = (await stat(file)).mode & 0o777;
    expect(
      (await invoke(["upgrade", file, "--config", host, "--in-place"])).code,
    ).toBe(0);
    expect(await readFile(file, "utf8")).toContain('"message": "Legacy"');
    expect((await stat(file)).mode & 0o777).toBe(mode);
    expect(await readdir(directory)).toEqual(["article.json"]);
  });

  it("never writes on migration failure", async () => {
    const broken = legacy.replace('"text":"Legacy"', '"wrong":true');
    await writeFile(file, broken);
    const result = await invoke([
      "upgrade",
      file,
      "--config",
      host,
      "--in-place",
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("migration-failed");
    expect(await readFile(file, "utf8")).toBe(broken);
    expect(await readdir(directory)).toEqual(["article.json"]);
  });

  it("refuses stale in-place writes and cleans staging when trusted config changed the source", async () => {
    const changing = join(directory, "changing.mjs");
    await writeFile(
      changing,
      `import host from ${JSON.stringify(pathToFileURL(host).href)};\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(file)}, 'Changed by host config');\nexport default host;\n`,
    );
    const result = await invoke([
      "upgrade",
      file,
      "--config",
      changing,
      "--in-place",
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("Source changed");
    expect(await readFile(file, "utf8")).toBe("Changed by host config");
    expect(await readdir(directory)).toEqual(["article.json", "changing.mjs"]);
  });

  it("loads an explicit ESM config and permits warning-only validation policy", async () => {
    const preserving = join(directory, "preserving.mjs");
    await writeFile(
      preserving,
      `import host from ${JSON.stringify(pathToFileURL(host).href)};\nexport default { prepare: { ...host.prepare, unknownBlocks: 'preserve', registry: { ...host.prepare.registry, get: () => undefined } } };\n`,
    );
    const result = await invoke(["validate", file, "--config", preserving]);
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("warning [unknown-block-type]");
    expect(await readFile(file, "utf8")).toBe(legacy);
  });

  it("rejects symlink and hard-linked sources for in-place upgrades", async () => {
    const symbolic = join(directory, "symbolic.json");
    await symlink(file, symbolic);
    expect(
      (await invoke(["upgrade", symbolic, "--in-place", "--config", host]))
        .code,
    ).toBe(2);
    const hard = join(directory, "hard.json");
    await link(file, hard);
    expect(
      (await invoke(["upgrade", file, "--in-place", "--config", host])).code,
    ).toBe(2);
    expect(await readFile(file, "utf8")).toBe(legacy);
  });

  it("uses configured profile severity for document exit status", async () => {
    await writeFile(
      file,
      '{"schemaVersion":1,"blocks":[{"id":"00000000-0000-4000-8000-00000000000f","type":"publisle:figure","schemaVersion":1,"data":{"src":"figure.svg"}}]}',
    );
    const result = await invoke(["validate", file, "--config", policy]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("error [missing-alternative-text]");
    expect(result.stderr).toContain(file);
  });

  it("validate --diagnostics json prints structured diagnostics on stdout", async () => {
    const markdown = join(directory, "source.md");
    await writeFile(markdown, "# Heading\n\nBody\n");
    const valid = await invoke([
      "validate",
      markdown,
      "--format",
      "markdown",
      "--diagnostics",
      "json",
    ]);
    expect(valid.code).toBe(0);
    const parsed = JSON.parse(valid.stdout) as {
      diagnostics: { level: string; code: string }[];
      valid: boolean;
    };
    expect(parsed.valid).toBe(true);
    expect(Array.isArray(parsed.diagnostics)).toBe(true);
    expect(valid.stderr).not.toContain("valid");

    await writeFile(file, "{");
    const invalid = await invoke(["validate", file, "--diagnostics", "json"]);
    expect(invalid.code).toBe(1);
    const invalidParsed = JSON.parse(invalid.stdout) as {
      diagnostics: { level: string; code: string }[];
      valid: boolean;
    };
    expect(invalidParsed.valid).toBe(false);
    expect(invalidParsed.diagnostics.length).toBeGreaterThan(0);
    const [first] = invalidParsed.diagnostics;
    expect(first?.level).toBe("error");
    expect(first?.code).toBeTruthy();
  });

  it("rejects --diagnostics outside validate and non-text/json values", async () => {
    expect(
      (await invoke(["upgrade", file, "--diagnostics", "json"])).code,
    ).toBe(2);
    expect(
      (await invoke(["validate", file, "--diagnostics", "yaml"])).code,
    ).toBe(2);
  });

  it("reports malformed JSON, missing plugins and config failures without writing", async () => {
    expect((await invoke(["validate", file])).code).toBe(1);
    await writeFile(file, "{");
    expect((await invoke(["validate", file])).code).toBe(1);
    expect(
      (
        await invoke([
          "upgrade",
          file,
          "--config",
          join(directory, "absent.mjs"),
        ])
      ).code,
    ).toBe(2);
    const invalidConfig = join(directory, "bad.mjs");
    await writeFile(invalidConfig, "export default { prepare: {} };");
    expect(
      (await invoke(["validate", file, "--config", invalidConfig])).code,
    ).toBe(2);
    expect(await readFile(file, "utf8")).toBe("{");
  });

  it("supports Markdown and explicit format, with diagnostics only on stderr", async () => {
    const markdown = join(directory, "source.txt");
    await writeFile(markdown, "# Heading\n\nBody\n");
    expect(
      (await invoke(["validate", markdown, "--format", "markdown"])).code,
    ).toBe(0);
    const upgraded = await invoke([
      "upgrade",
      markdown,
      "--format",
      "markdown",
    ]);
    expect(upgraded.code).toBe(0);
    expect(upgraded.stdout).toContain("# Heading");
    expect(upgraded.stdout).not.toContain("warning");
  });

  it("rejects ambiguous or unauthorized options before processing", async () => {
    for (const args of [
      [],
      ["validate"],
      ["other", file],
      ["validate", file, "--in-place"],
      ["validate", file, "--output", join(directory, "no.json")],
      ["upgrade", file, "--output", "x", "--in-place"],
      ["upgrade", file, "--format", "yaml"],
      ["upgrade", file, "--config"],
      ["upgrade", file, "--in-place", "--in-place"],
      ["upgrade", file, "--unknown"],
      ["upgrade", file, file],
    ])
      expect((await invoke(args)).code).toBe(2);
    expect(await readFile(file, "utf8")).toBe(legacy);
    expect((await invoke(["--help"])).stdout).toContain("Usage:");
  });

  it("builds markdown into a fresh static reader directory", async () => {
    const source = join(directory, "article.md");
    await writeFile(
      source,
      "---\ntitle: Built article\nlanguage: en\n---\n\n# Built\n\nHello static readers.\n",
    );
    const out = join(directory, "dist");
    const result = await invoke(["build", source, "--out", out]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("built index.html");
    const page = await readFile(join(out, "index.html"), "utf8");
    expect(page).toContain("<title>Built article</title>");
    expect(page).toContain('class="publisle-document"');
    expect(page).toContain('href="./katex.css"');
    expect(await readFile(join(out, "document.css"), "utf8")).toContain(
      ".publisle-document",
    );
    // The inlined KaTeX stylesheet ships real rules, not the @import stub.
    expect(await readFile(join(out, "katex.css"), "utf8")).toContain(".katex");
    const manifest: unknown = JSON.parse(
      await readFile(join(out, "publication.json"), "utf8"),
    );
    expect(manifest).toBeDefined();
    // A build output is always a fresh directory.
    expect((await invoke(["build", source, "--out", out])).code).toBe(2);
    expect((await invoke(["build", source])).code).toBe(2);
    expect(
      (await invoke(["build", source, "--out", out, "--unknown", "x"])).code,
    ).toBe(2);
  });

  it("builds configured JSON fixtures and rejects invalid documents", async () => {
    const out = join(directory, "configured");
    expect(
      (await invoke(["build", file, "--config", host, "--out", out])).code,
    ).toBe(0);
    expect(await readFile(join(out, "index.html"), "utf8")).toContain(
      "demo:notice",
    );
    expect(
      (await readdir(join(out, "fonts"))).some((name) =>
        name.endsWith(".woff2"),
      ),
    ).toBe(true);
    await writeFile(file, "{");
    expect(
      (await invoke(["build", file, "--out", join(directory, "invalid")])).code,
    ).toBe(1);
    expect(await readdir(directory)).not.toContain("invalid");
  });

  it("escapes document metadata in the static reader shell", async () => {
    await writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        metadata: { title: '<script>alert("x")</script>' },
        blocks: [],
      }),
    );
    const out = join(directory, "escaped");
    expect((await invoke(["build", file, "--out", out])).code).toBe(0);
    const html = await readFile(join(out, "index.html"), "utf8");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("build preserves unknown blocks as honest fallback content", async () => {
    const source = join(directory, "island.md");
    await writeFile(
      source,
      '# Island\n\n:::publisle{type="demo:notice" schemaVersion="1"}\n\n```json\n{"text":"Legacy"}\n```\n\n:::\n',
    );
    const out = join(directory, "dist");
    const result = await invoke(["build", source, "--out", out]);
    expect(result.code).toBe(0);
    const page = await readFile(join(out, "index.html"), "utf8");
    expect(page).toContain("data-publisle-unknown-block");
  });

  it("runs the actual executable with Node strip-only TypeScript and meaningful exit codes", async () => {
    const execute = promisify(execFile);
    const result = await execute(process.execPath, [
      bin,
      "validate",
      file,
      "--config",
      host,
    ]);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("valid");
    await expect(
      execute(process.execPath, [bin, "validate", file]),
    ).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("unknown-block-type") as unknown,
    });
  });
});

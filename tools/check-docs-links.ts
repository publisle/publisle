// Documentation link checker: every relative markdown link, image, and
// in-page anchor must resolve. Run via `pnpm docs:check`; wired into CI.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function walkMarkdown(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (!statSync(path).isDirectory()) {
      if (entry.endsWith(".md")) found.push(path);
      continue;
    }
    if (
      entry === "node_modules" ||
      entry === "dist" ||
      entry === ".svelte-kit" ||
      entry === ".next" ||
      entry === ".astro" ||
      entry === ".artifacts" ||
      entry === "generated"
    )
      continue;
    found.push(...walkMarkdown(path));
  }
  return found;
}

const files = [
  join(root, "README.md"),
  ...walkMarkdown(join(root, "docs")),
  ...walkMarkdown(join(root, "examples")).filter((file) =>
    file.endsWith("README.md"),
  ),
  ...walkMarkdown(join(root, "packages")).filter((file) =>
    file.endsWith("README.md"),
  ),
  ...walkMarkdown(join(root, "blocks")).filter((file) =>
    file.endsWith("README.md"),
  ),
  ...walkMarkdown(join(root, "showcase")).filter((file) =>
    file.endsWith("README.md"),
  ),
];

/** GitHub-style heading slug, close enough for anchor validation. */
function slugOf(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");
}

function headingsOf(content: string): Set<string> {
  const slugs = new Set<string>();
  let inFence = false;
  for (const line of content.split("\n")) {
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) slugs.add(slugOf(match[2] ?? ""));
  }
  return slugs;
}

const failures: string[] = [];
let checked = 0;

for (const file of files) {
  if (!existsSync(file)) {
    failures.push(`${relative(root, file)}: missing file (checker list)`);
    continue;
  }
  const content = readFileSync(file, "utf8");
  const anchors = headingsOf(content);
  const base = dirname(file);
  const references = [
    ...content.matchAll(/\[[^\]]*\]\(([^)\s]+)[^)]*\)/g),
    ...content.matchAll(/<img[^>]*\ssrc="([^"]+)"/g),
    ...content.matchAll(/<source[^>]*\ssrcset="([^"]+)"/g),
  ].map((match) => match[1] ?? "");
  for (const raw of references) {
    const target = raw.trim();
    if (
      target.startsWith("http://") ||
      target.startsWith("https://") ||
      target.startsWith("mailto:") ||
      target.startsWith("blob:") ||
      target.startsWith("data:")
    )
      continue;
    checked += 1;
    const [pathPart, anchor] = target.split("#") as [
      string,
      string | undefined,
    ];
    if (pathPart === "") {
      if (anchor && !anchors.has(anchor))
        failures.push(`${relative(root, file)}: broken anchor #${anchor}`);
      continue;
    }
    if (pathPart.startsWith("/")) {
      const route = pathPart.replace(/\/$/, "");
      const page = resolve(root, "sites/www/src/pages", `.${route}.astro`);
      const index = resolve(
        root,
        "sites/www/src/pages",
        `.${route}/index.astro`,
      );
      if (!existsSync(page) && !existsSync(index)) {
        failures.push(
          `${relative(root, file)}: broken link ${target} (no site page)`,
        );
      }
      continue;
    }
    const targetPath = resolve(base, pathPart);
    if (!existsSync(targetPath)) {
      failures.push(
        `${relative(root, file)}: broken link ${target} (resolved ${relative(root, targetPath)})`,
      );
      continue;
    }
    if (anchor && statSync(targetPath).isFile()) {
      const targetAnchors = headingsOf(readFileSync(targetPath, "utf8"));
      if (!targetAnchors.has(anchor))
        failures.push(
          `${relative(root, file)}: ${target} has no heading #${anchor}`,
        );
    }
  }
}

if (failures.length > 0) {
  console.error(
    `docs:check failed with ${String(failures.length)} broken reference(s):`,
  );
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(
  `docs:check passed: ${String(files.length)} files, ${String(checked)} relative references verified.`,
);

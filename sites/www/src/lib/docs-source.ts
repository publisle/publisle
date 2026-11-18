// Single source of truth for the documentation set loaded into the site:
// the Publisle content collection, the raw-markdown endpoints, and the
// GitHub links all enumerate from here.
import { existsSync } from "node:fs";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, join, resolve } from "node:path";

export type DocSection = "guides" | "standards";

export interface DocSource {
  /** Stable collection id, e.g. "guides/meaning" or "standards" (README). */
  readonly id: string;
  readonly section: DocSection;
  readonly title: string;
  /** Complete editorial summary for page and social metadata. */
  readonly description: string;
  /** Absolute path of the Markdown source in the checkout. */
  readonly file: string;
  /** Path under docs/ in the repository, e.g. "guides/meaning.md". */
  readonly repoPath: string;
}

/** repo/docs, resolved from the package working directory at build/dev time,
 * with the module-relative path as a fallback for direct Node usage. */
function resolveDocsRoot(): string {
  const candidates = [
    resolve(process.cwd(), "../../docs"),
    fileURLToPath(new URL("../../../../docs/", import.meta.url)),
  ];
  for (const candidate of candidates)
    if (existsSync(candidate)) return candidate;
  throw new Error(
    `Publisle docs directory not found (${candidates.join(", ")}).`,
  );
}

export const docsRoot: string = resolveDocsRoot();

const descriptions: Readonly<Record<string, string>> = {
  "guides/accessibility":
    "Review accessible web and PDF output, structural checks, mathematical alternatives, and the limits of automated conformance evidence.",
  "guides/contracts":
    "Create portable block contracts, validate their schemas, and consume locked definitions through preparation-only tooling.",
  "guides/exchange":
    "Lock portable documents, archive their resources, and serve publication artifacts while preserving the original source.",
  "guides/framework-hosts":
    "Integrate Publisle with Next.js, Astro, Vue, and Python while retaining control of routes, metadata, and implementation loaders.",
  "guides/journal-export":
    "Export research manuscripts to journal templates, LaTeX, and PDF with local compiler setup and explicit accessibility checks.",
  "guides/mcp":
    "Connect AI assistants to Publisle through a stateless MCP endpoint that edits documents, previews HTML, and exports PDF with the Rust compiler.",
  "guides/meaning":
    "Declare block meaning, traversal, and readable fallbacks without duplicating prose or embedding executable behavior.",
  "guides/performance-comparison":
    "Compare measured preparation, publication, reader delivery, and PDF compilation costs using reproducible benchmark evidence.",
  "guides/releases":
    "Prepare independent package releases, validate distribution artifacts, and publish compiler images with retained evidence.",
  "guides/reproductions":
    "Reproduce consumer and rendering problems by pinning source, package artifacts, compiler versions, and the failing environment.",
  standards:
    "Read the implemented Publisle beta contracts for portable documents, block definitions, preparation, exchange, and publishing.",
  "standards/composition":
    "Define bounded state and composition through the optional beta profile while preserving existing document and artifact versions.",
  "standards/conformance":
    "Identify consumer conformance roles, supported profiles, trust boundaries, and the fixture evidence required for each claim.",
  "standards/contracts":
    "Specify portable block definitions, local export, offline consumption, and the boundaries of trusted preparation callbacks.",
  "standards/delivery":
    "Specify native framework delivery and precompiled publication artifacts with shared island inputs and static fallback behavior.",
  "standards/exchange":
    "Specify locked source discovery, document manifests, archival Markdown, resources, and reproducible offline exchange.",
  "standards/json-wire":
    "Specify canonical UTF-8 JSON interchange, digest calculation, bounded parsing, and rejection of ambiguous wire representations.",
  "standards/meaning":
    "Specify descriptive meaning, declared traversal, and readable preservation for the implemented portable beta vocabulary.",
  "standards/myst":
    "Inspect the supported MyST mappings, machine-readable loss classifications, and boundaries of Markdown round-trip preservation.",
  "standards/performance-analysis":
    "Review preparation profiling, canonicalization costs, and measured optimizations for declared semantic traversal.",
  "standards/performance-budget-proposal":
    "Inspect the recorded runner calibration and baseline evidence used to propose reproducible preparation performance budgets.",
  "standards/performance-budgets":
    "Review accepted preparation performance caps, calibration evidence, and the conditions required to interpret budget results.",
  "standards/performance":
    "Measure preparation and serialization costs with static fixtures, reproducible inputs, and explicit measurement boundaries.",
  "standards/preparation":
    "Specify preparation order, normalization boundaries, validation groups, and the role of trusted preparation callbacks.",
  "standards/projections":
    "Specify semantic exports and renderer-free inspection while retaining canonical JSON and archival Markdown as authoritative source.",
  "standards/publishing":
    "Specify scholarly metadata, citation resolution, research projections, journal templates, and publishing conformance for the beta profile.",
  "standards/schema-profile":
    "Specify the offline structural JSON Schema profile, supported validation behavior, and diagnostics for invalid portable contracts.",
};

/** Repository path of a doc's Markdown source (README lives at the bare id). */
export function docRepoPath(id: string): string {
  return id === "standards" ? "standards/README.md" : `${id}.md`;
}

/** On-site raw route serving the exact Markdown source. */
export function docRawRoute(id: string): string {
  return `/docs/${docRepoPath(id)}`;
}

/** First prose paragraph of a document, flattened to ~155 plain characters. */
export function describeMarkdown(source: string): string {
  const lines = source.split("\n");
  const paragraph: string[] = [];
  for (const line of lines.slice(
    lines.findIndex((line) => line.startsWith("# ")) + 1,
  )) {
    const trimmed = line.trim();
    if (trimmed === "") {
      if (paragraph.length > 0) break;
      continue;
    }
    if (/^(#|>|\||[-*]\s|```|\s{4})/.test(trimmed)) continue;
    paragraph.push(trimmed);
  }
  const plain = paragraph
    .join(" ")
    .replaceAll(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replaceAll(/`([^`]*)`/gu, "$1")
    .replaceAll(/[*_]/gu, "")
    .replaceAll(/\s+/gu, " ")
    .trim();
  if (plain.length <= 155) return plain;
  const cut = plain.slice(0, 155);
  const boundary = cut.lastIndexOf(" ");
  return `${cut.slice(0, boundary > 80 ? boundary : 155).trimEnd()}…`;
}

function sectionSources(section: DocSection): DocSource[] {
  const dir = join(docsRoot, section);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const file = join(dir, name);
      const source = readFileSync(file, "utf8");
      const heading = /^#\s+(.+?)\s*$/mu.exec(source)?.[1];
      const base = basename(name, ".md");
      const isReadme = name === "README.md";
      return {
        id: isReadme ? section : `${section}/${base}`,
        section,
        title: heading ?? (isReadme ? section : base),
        description:
          descriptions[isReadme ? section : `${section}/${base}`] ??
          describeMarkdown(source),
        file,
        repoPath: `${section}/${name}`,
      };
    });
}

let cached: DocSource[] | undefined;

export function docSources(): DocSource[] {
  cached ??= [...sectionSources("guides"), ...sectionSources("standards")];
  return cached;
}

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseBibtex } from "./bibtex.ts";
import type { CitationEntry } from "./article.ts";

export interface BibliographyFetchOptions {
  readonly cacheDirectory: string;
  readonly refresh?: boolean;
  readonly fetch?: typeof globalThis.fetch;
}
export interface BibliographyImport {
  readonly entries: readonly CitationEntry[];
  readonly items: readonly Readonly<Record<string, unknown>>[];
  readonly provenance: {
    readonly url: string;
    readonly fetchedAt: string;
    readonly sha256: string;
  };
}
/** Preserve complete CSL records for citeproc, alongside the portable bibliography projection. */
export function importCslJson(source: string): {
  entries: CitationEntry[];
  items: Record<string, unknown>[];
} {
  const parsed: unknown = JSON.parse(source);
  const listed = Array.isArray(parsed) ? parsed : [parsed];
  const items = listed.map((item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("CSL bibliography items must be objects.");
    return item as Record<string, unknown>;
  });
  const entries = items.map((item): CitationEntry => {
    const id = item["id"] ?? item["DOI"];
    if (typeof id !== "string" && typeof id !== "number")
      throw new Error("CSL item requires an id or DOI.");
    item["id"] = String(id);
    const authors = Array.isArray(item["author"])
      ? item["author"].map((name: unknown) => {
          const person = name as Record<string, unknown>;
          return typeof person["literal"] === "string"
            ? person["literal"]
            : [person["family"], person["given"]]
                .filter((value) => typeof value === "string")
                .join(", ");
        })
      : [];
    const fields: Record<string, string> = {};
    for (const [target, key] of Object.entries({
      type: "type",
      title: "title",
      containerTitle: "container-title",
      volume: "volume",
      issue: "issue",
      page: "page",
      publisher: "publisher",
      doi: "DOI",
      url: "URL",
    }))
      if (typeof item[key] === "string") fields[target] = item[key];
    const issued = item["issued"] as { "date-parts"?: number[][] } | undefined;
    const year = issued?.["date-parts"]?.[0]?.[0];
    return {
      id: String(id),
      authors,
      ...fields,
      ...(year === undefined ? {} : { issued: String(year) }),
    };
  });
  return { entries, items };
}
/** Opt-in metadata acquisition. Exporters never call this API. Cached results work offline. */
export async function fetchBibliography(
  url: string,
  options: BibliographyFetchOptions,
): Promise<BibliographyImport> {
  if (new URL(url).protocol !== "https:")
    throw new Error("Remote bibliographies require HTTPS.");
  const key = createHash("sha256").update(url).digest("hex");
  const path = join(options.cacheDirectory, `${key}.json`);
  if (!options.refresh) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as BibliographyImport;
    } catch (error) {
      if (!(
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
  }
  const request = options.fetch ?? globalThis.fetch;
  let destination = url;
  let response: Response | undefined;
  for (let hop = 0; hop < 6; hop++) {
    response = await request(destination, {
      redirect: "manual",
      headers: {
        Accept:
          "application/vnd.citationstyles.csl+json, application/x-bibtex;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status < 300 || response.status >= 400) break;
    const location = response.headers.get("location");
    if (!location)
      throw new Error("Bibliography redirect lacks a destination.");
    destination = new URL(location, destination).href;
    if (new URL(destination).protocol !== "https:")
      throw new Error("Bibliography redirect requires HTTPS.");
  }
  if (!response?.ok)
    throw new Error(`Bibliography fetch failed: ${String(response?.status)}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Bibliography response has no body.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 2 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("Bibliography exceeds 2 MiB.");
    }
    chunks.push(value);
  }
  const bytes = Buffer.concat(chunks);
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const data = source.trimStart().startsWith("@")
    ? { entries: parseBibtex(source), items: [] }
    : importCslJson(source);
  const result = {
    ...data,
    provenance: {
      url,
      fetchedAt: new Date().toISOString(),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
  await mkdir(options.cacheDirectory, { recursive: true });
  await writeFile(path, JSON.stringify(result) + "\n");
  return result;
}
export async function lookupDoi(
  doi: string,
  options: BibliographyFetchOptions,
): Promise<BibliographyImport> {
  const normalized = doi
    .replace(/^https:\/\/doi\.org\//iu, "")
    .replace(/^doi:\s*/iu, "")
    .trim();
  if (!/^10\.\d{4,9}\/\S+$/u.test(normalized)) throw new Error("Invalid DOI.");
  return fetchBibliography(
    `https://doi.org/${normalized
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/")}`,
    options,
  );
}

/** Maximum bytes for a fetched raster/vector image (service parity). */
const IMAGE_BYTES = 4 * 1024 * 1024;
/** Maximum bytes for a fetched PDF figure (service parity). */
const PDF_BYTES = 16 * 1024 * 1024;

/**
 * Reject SVG sources that are not self-contained before any decoder runs:
 * no doctype, entities, script, foreign objects, stylesheets, escapes,
 * imports, or external href/url references.
 */
export function checkSvg(source: string): void {
  if (
    !/<svg(?:\s|>)/iu.test(source) ||
    /<!DOCTYPE|<!ENTITY|<script\b|<foreignObject\b|<\?xml-stylesheet|\\|@import/iu.test(
      source,
    ) ||
    [...source.matchAll(/(?:\b|:)href\s*=\s*(["'])(.*?)\1/giu)].some(
      (match) => !/^#[A-Za-z0-9_.:-]+$/u.test(match[2] ?? ""),
    ) ||
    [...source.matchAll(/url\s*\((.*?)\)/giu)].some(
      (match) => !/^\s*["']?#[A-Za-z0-9_.:-]+["']?\s*$/u.test(match[1] ?? ""),
    )
  )
    throw new Error(
      "SVG images must be self-contained and contain no active content.",
    );
}

export interface FigureFetchOptions {
  /** Dependency injection for tests; production uses global fetch. */
  readonly fetch?: typeof globalThis.fetch;
  /** Total fetch deadline, default 10 seconds (service parity). */
  readonly timeoutMs?: number;
}

export interface FetchedFigure {
  readonly bytes: Uint8Array;
  readonly extension: "png" | "jpg" | "pdf";
}

/**
 * Fetch a remote figure with the hosted service's safety rules: HTTPS only,
 * content-type allowlist, per-figure byte caps, and self-contained SVGs
 * rasterized to PNG through sharp.
 */
export async function fetchFigureAsset(
  url: string,
  options: FigureFetchOptions = {},
): Promise<FetchedFigure> {
  if (!url.startsWith("https://"))
    throw new Error(`Remote figure assets require HTTPS: ${url}`);
  const request = options.fetch ?? globalThis.fetch;
  const response = await request(url, {
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
    headers: {
      accept: "image/png, image/jpeg, image/svg+xml, application/pdf",
    },
  });
  if (!response.ok)
    throw new Error(
      `Figure fetch failed with HTTP ${String(response.status)}.`,
    );
  const type = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();
  const declared =
    type === "image/svg+xml"
      ? "svg"
      : type === "image/jpeg"
        ? "jpg"
        : type === "image/png"
          ? "png"
          : type === "application/pdf"
            ? "pdf"
            : undefined;
  if (!declared)
    throw new Error(`Unsupported figure content type: ${type ?? "missing"}.`);
  const cap = declared === "pdf" ? PDF_BYTES : IMAGE_BYTES;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > cap)
    throw new Error(
      `Figure exceeds ${String(Math.floor(cap / 1024 / 1024))} MiB.`,
    );
  if (declared === "pdf") return { bytes, extension: "pdf" };
  const { default: sharp } = await import("sharp");
  sharp.cache(false);
  sharp.concurrency(1);
  const image = sharp(bytes, {
    limitInputPixels: 8_000_000,
    failOn: "warning",
    animated: false,
  });
  if (declared === "svg") {
    checkSvg(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > 8_000_000
    )
      throw new Error("Invalid or oversized SVG figure.");
    return {
      bytes: new Uint8Array(await image.png().toBuffer()),
      extension: "png",
    };
  }
  const metadata = await image.metadata();
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width * metadata.height > 8_000_000 ||
    metadata.format !== (declared === "jpg" ? "jpeg" : declared)
  )
    throw new Error("Invalid or oversized image figure.");
  return { bytes, extension: declared };
}

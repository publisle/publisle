import type { CitationEntry } from "./article.ts";

const TYPE_TO_BIBTEX: Readonly<Record<string, string>> = {
  "article-journal": "article",
  book: "book",
  "paper-conference": "inproceedings",
  chapter: "incollection",
  report: "techreport",
  thesis: "phdthesis",
  webpage: "online",
};

const BIBTEX_TO_TYPE: Readonly<Record<string, string>> = {
  article: "article-journal",
  book: "book",
  inproceedings: "paper-conference",
  conference: "paper-conference",
  incollection: "chapter",
  techreport: "report",
  phdthesis: "thesis",
  online: "webpage",
  misc: "document",
};

function balanced(
  source: string,
  start: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error("BibTeX value is missing its closing delimiter.");
}

function skipSpace(source: string, index: number): number {
  let cursor = index;
  while (cursor < source.length) {
    const char = source[cursor];
    if (char === "%") {
      const line = source.indexOf("\n", cursor);
      cursor = line === -1 ? source.length : line + 1;
      continue;
    }
    if (char !== undefined && /\s/u.test(char)) {
      cursor += 1;
      continue;
    }
    break;
  }
  return cursor;
}

function readValue(
  source: string,
  index: number,
): { value: string; index: number } {
  const start = skipSpace(source, index);
  const char = source[start];
  if (char === "{") {
    const end = balanced(source, start, "{", "}");
    return { value: source.slice(start + 1, end), index: end + 1 };
  }
  if (char === '"') {
    const end = source.indexOf('"', start + 1);
    if (end === -1) throw new Error("BibTeX quoted value is not closed.");
    return { value: source.slice(start + 1, end), index: end + 1 };
  }
  let end = start;
  while (end < source.length && source[end] !== "," && source[end] !== "}")
    end += 1;
  return { value: source.slice(start, end).trim(), index: end };
}

function splitAuthors(value: string): string[] {
  const people: string[] = [];
  let current = "";
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "{") depth += 1;
    if (char === "}") depth = Math.max(0, depth - 1);
    if (
      depth === 0 &&
      value.slice(index, index + 5).toLowerCase() === " and "
    ) {
      people.push(current.trim());
      current = "";
      index += 4;
      continue;
    }
    current += char ?? "";
  }
  if (current.trim()) people.push(current.trim());
  return people.map((person) => {
    const comma = person.indexOf(",");
    if (comma !== -1)
      return `${person.slice(0, comma).trim()}, ${person.slice(comma + 1).trim()}`.replace(
        /, $/,
        "",
      );
    const parts = person.split(/\s+/u).filter((part) => part.length > 0);
    if (parts.length < 2) return person;
    const family = parts[parts.length - 1] ?? person;
    return `${family}, ${parts.slice(0, -1).join(" ")}`;
  });
}

/** Parse BibTeX entries. `raw` is the original entry text, unchanged. */
export function parseBibtex(source: string): CitationEntry[] {
  const entries: CitationEntry[] = [];
  let index = 0;
  while (index < source.length) {
    const at = source.indexOf("@", index);
    if (at === -1) break;
    const typeMatch = /^@([A-Za-z]+)\{/u.exec(source.slice(at));
    if (!typeMatch) {
      index = at + 1;
      continue;
    }
    const bibType = (typeMatch[1] ?? "").toLowerCase();
    if (
      bibType === "comment" ||
      bibType === "string" ||
      bibType === "preamble"
    ) {
      index = balanced(source, at + typeMatch[0].length - 1, "{", "}") + 1;
      continue;
    }
    const keyStart = at + typeMatch[0].length;
    const keyEnd = source.indexOf(",", keyStart);
    if (keyEnd === -1)
      throw new Error("BibTeX entry is missing its citation key.");
    const id = source.slice(keyStart, keyEnd).trim();
    if (!id) throw new Error("BibTeX citation key is empty.");
    const fields = new Map<string, string>();
    let cursor = keyEnd + 1;
    const entryEnd = balanced(source, at + typeMatch[0].length - 1, "{", "}");
    while (cursor < entryEnd) {
      cursor = skipSpace(source, cursor);
      if (cursor >= entryEnd) break;
      const nameEnd = source.slice(cursor).search(/[\s=]/u);
      if (nameEnd <= 0)
        throw new Error(`BibTeX field name is missing in ${id}.`);
      const name = source.slice(cursor, cursor + nameEnd).toLowerCase();
      cursor = skipSpace(source, cursor + nameEnd);
      if (source[cursor] !== "=")
        throw new Error(`BibTeX field ${name} is missing '='.`);
      const read = readValue(source, cursor + 1);
      fields.set(name, read.value.trim());
      cursor = skipSpace(source, read.index);
      if (source[cursor] === ",") cursor += 1;
    }
    const authors = fields.has("author")
      ? splitAuthors(fields.get("author") ?? "")
      : [];
    const title = fields.get("title");
    const issued = fields.get("year");
    const containerTitle = fields.get("journal") ?? fields.get("booktitle");
    const volume = fields.get("volume");
    const issue = fields.get("number");
    const page = fields.get("pages");
    const publisher = fields.get("publisher");
    const edition = fields.get("edition");
    const doi = fields.get("doi");
    const url = fields.get("url");
    const raw = source.slice(at, entryEnd + 1);
    entries.push({
      id,
      type: BIBTEX_TO_TYPE[bibType] ?? "document",
      authors,
      raw,
      ...(title === undefined ? {} : { title }),
      ...(issued === undefined ? {} : { issued }),
      ...(containerTitle === undefined ? {} : { containerTitle }),
      ...(volume === undefined ? {} : { volume }),
      ...(issue === undefined ? {} : { issue }),
      ...(page === undefined ? {} : { page }),
      ...(publisher === undefined ? {} : { publisher }),
      ...(edition === undefined ? {} : { edition }),
      ...(doi === undefined ? {} : { doi }),
      ...(url === undefined ? {} : { url }),
    });
    index = entryEnd + 1;
  }
  return entries;
}

function brace(value: string): string {
  return `{${value}}`;
}

function structured(entry: CitationEntry): boolean {
  return (
    entry.title !== undefined ||
    entry.authors.length > 0 ||
    entry.issued !== undefined ||
    entry.containerTitle !== undefined ||
    entry.volume !== undefined ||
    entry.issue !== undefined ||
    entry.page !== undefined ||
    entry.publisher !== undefined ||
    entry.edition !== undefined ||
    entry.doi !== undefined ||
    entry.url !== undefined
  );
}

/** Write BibTeX. An entry that only has `raw` is copied exactly. */
export function toBibtex(entries: readonly CitationEntry[]): string {
  return entries
    .map((entry) => {
      if (!structured(entry) && entry.raw !== undefined) return entry.raw;
      const type = TYPE_TO_BIBTEX[entry.type ?? ""] ?? "misc";
      const fields = [
        entry.authors.length > 0
          ? `  author = ${brace(entry.authors.join(" and "))}`
          : undefined,
        entry.title === undefined
          ? undefined
          : `  title = ${brace(entry.title)}`,
        entry.containerTitle === undefined
          ? undefined
          : `  ${type === "article" ? "journal" : "booktitle"} = ${brace(entry.containerTitle)}`,
        entry.issued === undefined
          ? undefined
          : `  year = ${brace(entry.issued)}`,
        entry.volume === undefined
          ? undefined
          : `  volume = ${brace(entry.volume)}`,
        entry.issue === undefined
          ? undefined
          : `  number = ${brace(entry.issue)}`,
        entry.page === undefined ? undefined : `  pages = ${brace(entry.page)}`,
        entry.publisher === undefined
          ? undefined
          : `  publisher = ${brace(entry.publisher)}`,
        entry.edition === undefined
          ? undefined
          : `  edition = ${brace(entry.edition)}`,
        entry.doi === undefined ? undefined : `  doi = ${brace(entry.doi)}`,
        entry.url === undefined ? undefined : `  url = ${brace(entry.url)}`,
      ].filter((field): field is string => field !== undefined);
      return `@${type}{${entry.id},\n${fields.join(",\n")}\n}`;
    })
    .join("\n\n");
}

export function toCslJson(entries: readonly CitationEntry[]): string {
  return JSON.stringify(
    entries.map((entry) => ({
      id: entry.id,
      type: entry.type ?? "document",
      ...(entry.title === undefined ? {} : { title: entry.title }),
      ...(entry.authors.length === 0
        ? {}
        : {
            author: entry.authors.map((author) => {
              const comma = author.indexOf(",");
              if (comma === -1) return { family: author };
              const given = author.slice(comma + 1).trim();
              return given.length === 0
                ? { family: author.slice(0, comma).trim() }
                : { family: author.slice(0, comma).trim(), given };
            }),
          }),
      ...(entry.issued !== undefined && /^\d{4}/u.test(entry.issued)
        ? { issued: { "date-parts": [[Number(entry.issued.slice(0, 4))]] } }
        : {}),
      ...(entry.containerTitle === undefined
        ? {}
        : { "container-title": entry.containerTitle }),
      ...(entry.volume === undefined ? {} : { volume: entry.volume }),
      ...(entry.issue === undefined ? {} : { issue: entry.issue }),
      ...(entry.page === undefined ? {} : { page: entry.page }),
      ...(entry.publisher === undefined ? {} : { publisher: entry.publisher }),
      ...(entry.edition === undefined ? {} : { edition: entry.edition }),
      ...(entry.doi === undefined ? {} : { DOI: entry.doi }),
      ...(entry.url === undefined ? {} : { URL: entry.url }),
    })),
    null,
    2,
  );
}

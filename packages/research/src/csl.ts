import CSL from "citeproc";
import { locales } from "./locales.ts";
import { toCslJson } from "./bibtex.ts";
import type {
  CitationCluster,
  CitationEntry,
  ResearchLoss,
} from "./article.ts";

export interface XmlElement {
  readonly type: "element";
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
}
export type XmlNode =
  XmlElement | { readonly type: "text"; readonly value: string };

// These styles deliberately share field coverage. Empty groups suppress their
// punctuation, so partial records do not acquire empty issue/edition markers.
const BIBLIOGRAPHY_DETAILS = `
  <macro name="publication-details">
    <group delimiter=". ">
      <choose>
        <if type="article-journal article-magazine article-newspaper" match="any">
          <group delimiter=", ">
            <text variable="container-title"/>
            <group delimiter=": ">
              <group><text variable="volume"/><text variable="issue" prefix="(" suffix=")"/></group>
              <text variable="page"/>
            </group>
          </group>
        </if>
        <else>
          <group delimiter=", ">
            <text variable="container-title"/>
            <group delimiter=" "><label variable="volume" form="short"/><text variable="volume"/></group>
            <text variable="issue" prefix="(" suffix=")"/>
            <group delimiter=" "><label variable="page" form="short"/><text variable="page"/></group>
          </group>
        </else>
      </choose>
      <group delimiter=", ">
        <group delimiter=" "><number variable="edition" form="ordinal"/><label variable="edition" form="short"/></group>
        <text variable="publisher"/>
      </group>
    </group>
  </macro>
  <macro name="identifiers">
    <group delimiter=". ">
      <text variable="DOI" prefix="https://doi.org/"/>
      <text variable="URL"/>
    </group>
  </macro>`;

const NUMERIC_STYLE = `<?xml version="1.0"?>
<style class="in-text" version="1.0">
  <info><title>Publisle numeric</title><category citation-format="numeric"/></info>
  ${BIBLIOGRAPHY_DETAILS}
  <citation collapse="citation-number">
    <sort><key variable="citation-number"/></sort>
    <layout prefix="[" suffix="]" delimiter=", ">
      <text variable="citation-number"/><group prefix=", " delimiter=" "><label variable="locator" form="short"/><text variable="locator"/></group>
    </layout>
  </citation>
  <bibliography>
    <layout>
      <text variable="citation-number" suffix=". "/>
      <names variable="author"><name form="long" and="text" delimiter=", "/><et-al term="et-al"/></names>
      <text variable="title" prefix=", "/>
      <text macro="publication-details" prefix=". "/>
      <date variable="issued" prefix=" (" suffix=")"><date-part name="year"/></date>
      <text macro="identifiers" prefix=". "/>
    </layout>
  </bibliography>
</style>`;

const AUTHOR_DATE_STYLE = `<?xml version="1.0"?>
<style class="in-text" version="1.0">
  <info><title>Publisle author-date</title><category citation-format="author-date"/></info>
  ${BIBLIOGRAPHY_DETAILS}
  <macro name="author-short">
    <names variable="author">
      <name form="short" and="symbol" delimiter=", "/>
      <et-al term="et-al"/>
    </names>
  </macro>
  <citation et-al-min="3" et-al-use-first="1" disambiguate-add-year-suffix="true" disambiguate-add-givenname="true">
    <layout prefix="(" suffix=")" delimiter="; ">
      <group delimiter=", ">
        <text macro="author-short"/>
        <date variable="issued"><date-part name="year"/></date>
      </group>
    </layout>
  </citation>
  <bibliography>
    <sort><key variable="author"/><key variable="issued"/></sort>
    <layout suffix=".">
      <names variable="author"><name and="text" name-as-sort-order="first" delimiter=", "/></names>
      <date variable="issued" prefix=" (" suffix=")"><date-part name="year"/></date>
      <text variable="title" prefix=". "/>
      <text macro="publication-details" prefix=". "/>
      <text macro="identifiers" prefix=". "/>
    </layout>
  </bibliography>
</style>`;

function decodeXml(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[a-f0-9]+);/giu,
    (entity) => {
      const named: Readonly<Record<string, string>> = {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      };
      if (named[entity]) return named[entity];
      return String.fromCodePoint(
        entity.startsWith("&#x")
          ? parseInt(entity.slice(3, -1), 16)
          : parseInt(entity.slice(2, -1), 10),
      );
    },
  );
}
function parseXml(source: string): XmlElement {
  let index = 0;
  const skip = () => {
    while (index < source.length) {
      if (source.startsWith("<!--", index)) {
        const end = source.indexOf("-->", index);
        if (end === -1) throw new Error("CSL comment is not closed.");
        index = end + 3;
        continue;
      }
      if (source.startsWith("<?", index) || source.startsWith("<!", index)) {
        const end = source.indexOf(">", index);
        if (end === -1) throw new Error("CSL declaration is not closed.");
        index = end + 1;
        continue;
      }
      if (/\s/u.test(source[index] ?? "")) {
        index += 1;
        continue;
      }
      break;
    }
  };
  const readAttributes = (): Record<string, string> => {
    const attributes: Record<string, string> = {};
    while (
      index < source.length &&
      source[index] !== ">" &&
      source[index] !== "/"
    ) {
      if (/\s/u.test(source[index] ?? "")) {
        index += 1;
        continue;
      }
      const nameEnd = source.slice(index).search(/[\s=/>]/u);
      if (nameEnd <= 0) throw new Error("CSL attribute name is missing.");
      const name = source.slice(index, index + nameEnd);
      index += nameEnd;
      while (/\s/u.test(source[index] ?? "")) index += 1;
      if (source[index] !== "=")
        throw new Error(`CSL attribute ${name} is missing a value.`);
      index += 1;
      while (/\s/u.test(source[index] ?? "")) index += 1;
      const quote = source[index];
      if (quote !== '"' && quote !== "'")
        throw new Error(`CSL attribute ${name} is not quoted.`);
      const valueEnd = source.indexOf(quote, index + 1);
      if (valueEnd === -1)
        throw new Error(`CSL attribute ${name} is not closed.`);
      attributes[name] = decodeXml(source.slice(index + 1, valueEnd));
      index = valueEnd + 1;
    }
    return attributes;
  };
  const readNodes = (until: string): XmlNode[] => {
    const children: XmlNode[] = [];
    while (index < source.length && !source.startsWith(until, index)) {
      if (source.startsWith("<!--", index)) {
        const end = source.indexOf("-->", index);
        if (end < 0) throw new Error("Unclosed CSL comment");
        index = end + 3;
        continue;
      }
      if (source[index] === "<") children.push(readElement());
      else {
        const next = source.indexOf("<", index);
        const value = source.slice(index, next === -1 ? source.length : next);
        index = next === -1 ? source.length : next;
        if (value.trim().length > 0)
          children.push({ type: "text", value: decodeXml(value.trim()) });
      }
    }
    return children;
  };
  const readElement = (): XmlElement => {
    if (source[index] !== "<") throw new Error("Expected a CSL element.");
    index += 1;
    const nameEnd = source.slice(index).search(/[\s/>]/u);
    if (nameEnd <= 0) throw new Error("CSL element name is missing.");
    const name = source.slice(index, index + nameEnd);
    index += nameEnd;
    const attributes = readAttributes();
    if (source.startsWith("/>", index)) {
      index += 2;
      return { type: "element", name, attributes, children: [] };
    }
    if (source[index] !== ">")
      throw new Error(`CSL element ${name} is not closed.`);
    index += 1;
    const children = readNodes(`</${name}>`);
    if (!source.startsWith(`</${name}>`, index))
      throw new Error(`CSL element ${name} has no end tag.`);
    index += name.length + 3;
    return { type: "element", name, attributes, children };
  };
  skip();
  const root = readElement();
  skip();
  if (index < source.length) throw new Error("CSL style has trailing content.");
  if (root.name !== "style") throw new Error("CSL root element must be style.");
  return root;
}

export function builtinCsl(name: "numeric" | "author-date"): XmlElement {
  return parseXml(name === "numeric" ? NUMERIC_STYLE : AUTHOR_DATE_STYLE);
}

export function parseCslStyle(xml: string): XmlElement {
  return parseXml(xml);
}

function descendants(node: XmlElement, name: string): XmlElement[] {
  const found: XmlElement[] = [];
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.name === name) found.push(child);
    found.push(...descendants(child, name));
  }
  return found;
}

function attr(node: XmlElement, name: string): string | undefined {
  return node.attributes[name];
}

export type CitationForm = "numeric" | "author-date" | "note";

export function citationForm(style: XmlElement): CitationForm {
  if (style.attributes["class"] === "note") return "note";
  const category = descendants(style, "category").find((item) =>
    attr(item, "citation-format"),
  );
  const format = category ? attr(category, "citation-format") : undefined;
  if (format === "numeric") return "numeric";
  if (format === "author-date") return "author-date";
  return style.attributes["class"] === "in-text"
    ? descendants(style, "text").some(
        (node) => node.attributes["variable"] === "citation-number",
      )
      ? "numeric"
      : "author-date"
    : "note";
}

export interface FormattedResearch {
  readonly form: CitationForm;
  readonly citations: readonly string[];
  readonly bibliography: readonly {
    readonly id: string;
    readonly label: string;
    readonly text: string;
  }[];
  readonly unresolved: readonly string[];
  readonly losses: readonly ResearchLoss[];
}

export interface CslOptions {
  readonly locale?: string;
  readonly locales?: Readonly<Record<string, string>>;
  /** Complete CSL-JSON records, including structured names, dates and additional variables. */
  readonly items?: readonly Readonly<Record<string, unknown>>[];
  readonly noteIndices?: readonly number[];
}
function xml(node: XmlNode): string {
  const escape = (value: string) =>
    value
      .replace(/&/gu, "&amp;")
      .replace(/"/gu, "&quot;")
      .replace(/</gu, "&lt;");
  if (node.type === "text") return escape(node.value);
  return `<${node.name}${Object.entries(node.attributes)
    .map(([key, value]) => ` ${key}="${escape(value)}"`)
    .join("")}>${node.children.map(xml).join("")}</${node.name}>`;
}
export function formatCitations(
  entries: readonly CitationEntry[],
  clusters: readonly CitationCluster[],
  style: XmlElement,
  options: CslOptions = {},
): FormattedResearch {
  const records = JSON.parse(toCslJson(entries)) as Record<string, unknown>[];
  const byId = new Map(records.map((item) => [String(item["id"]), item]));
  for (const item of options.items ?? [])
    byId.set(String(item["id"]), structuredClone(item));
  const losses: ResearchLoss[] = [];
  for (const entry of entries)
    if (entry.raw && !entry.title && !entry.authors.length && !entry.issued) {
      byId.set(entry.id, { id: entry.id, type: "document", title: entry.raw });
      losses.push({
        code: "opaque-reference-literal",
        message: `Reference ${entry.id} is preserved literally and cannot be restyled.`,
      });
    }
  const unresolved = [
    ...new Set(
      clusters.flatMap((cluster) =>
        cluster.items
          .filter((item) => !byId.has(item.id))
          .map((item) => item.id),
      ),
    ),
  ];
  for (const id of unresolved)
    losses.push({
      code: "unresolved-citation",
      message: `Citation ${id} has no bibliography entry.`,
    });
  const localeMap = { ...locales, ...options.locales };
  const processor = new CSL.Engine(
    {
      retrieveLocale: (language: string) => {
        const exact = localeMap[language];
        if (exact) return exact;
        const match = Object.keys(localeMap).find(
          (key) => key.split("-")[0] === language.split("-")[0],
        );
        if (match) return localeMap[match] ?? "";
        throw new Error(`No CSL locale resource for ${language}`);
      },
      retrieveItem: (id: string) =>
        byId.get(id) ?? { id, type: "document", title: id },
    },
    xml(style),
    options.locale ?? "en-US",
    Boolean(options.locale),
  );
  processor.setOutputFormat("text");
  const form = citationForm(style);
  const citations: string[] = clusters.map(() => "");
  const history: [string, number][] = [];
  const positions: number[] = [];
  clusters.forEach((cluster, index) => {
    const noteIndex =
      options.noteIndices?.[index] ?? (form === "note" ? index + 1 : 0);
    const citation = {
      citationID: `publisle-${String(index)}`,
      citationItems: cluster.items
        .filter((item) => byId.has(item.id))
        .map((item) => ({
          id: item.id,
          ...(item.locator
            ? {
                locator: item.locator,
                label: item.label === "p." ? "page" : (item.label ?? "page"),
              }
            : {}),
          ...(item.suppressAuthor ? { "suppress-author": true } : {}),
        })),
      properties: { noteIndex },
    };
    if (citation.citationItems.length) {
      const result = processor.processCitationCluster(citation, history, []);
      positions.push(index);
      for (const [position, value] of result[1]) {
        const target = positions[position];
        if (target !== undefined) citations[target] = value;
      }
      history.push([citation.citationID, noteIndex]);
    }
  });
  clusters.forEach((cluster, index) => {
    const missing = cluster.items
      .filter((item) => !byId.has(item.id))
      .map((item) => item.id);
    citations[index] =
      `${cluster.prefix ?? ""}${citations[index] ?? ""}${missing.length ? `[${missing.join(", ")}]` : ""}${cluster.suffix ?? ""}`;
  });
  const bibliographyResult = processor.makeBibliography();
  const bibliography = bibliographyResult
    ? bibliographyResult[1].map((text, index) => ({
        id: bibliographyResult[0].entry_ids[index]?.[0] ?? "",
        label: String(index + 1),
        text: text.trim(),
      }))
    : [];
  return { form, citations, bibliography, unresolved, losses };
}

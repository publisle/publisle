import { definePortableBlock } from "@publisle/block-sdk";
import { builtinContractSource } from "@publisle/contracts/builtin-sources";
import { coreTraversal } from "./traversal.ts";
import { SchemaParseError } from "@publisle/schema";
import {
  flowNodes,
  inlineNodes,
  listItems,
  nonemptyString,
  record,
  string,
} from "./parse.ts";
import type {
  CalloutData,
  CodeData,
  DiagramData,
  DownloadableResource,
  EmbedData,
  FigureData,
  BibliographyData,
  FootnoteData,
  HeadingData,
  ListData,
  MathData,
  ParagraphData,
  QuoteData,
  RawHtmlData,
  TableData,
} from "./types.ts";

function booleanValue(
  value: unknown,
  label: string,
  whenAbsent: boolean,
): boolean {
  if (value === undefined) return whenAbsent;
  if (typeof value !== "boolean")
    throw new SchemaParseError(
      "invalid-block-data",
      `${label} must be a boolean.`,
    );
  return value;
}

function optionalString(data: Record<string, unknown>, key: string) {
  return typeof data[key] === "string" ? { [key]: data[key] } : {};
}

/** Figure variant renditions: lowercase variant name → source URL. */
function optionalVariants(data: Record<string, unknown>) {
  if (data["variants"] === undefined) return {};
  if (typeof data["variants"] !== "object" || data["variants"] === null)
    throw new SchemaParseError(
      "invalid-block-data",
      "figure variants must map variant names to source strings.",
    );
  const variants: Record<string, string> = {};
  for (const [name, src] of Object.entries(data["variants"])) {
    if (!/^[a-z][a-z0-9-]*$/u.test(name) || typeof src !== "string")
      throw new SchemaParseError(
        "invalid-block-data",
        `figure variant "${name}" must be a lowercase name mapping to a source string.`,
      );
    variants[name] = src;
  }
  return { variants };
}

function optionalLabel(data: Record<string, unknown>) {
  if (data["label"] === undefined) return {};
  const label = nonemptyString(data["label"], "label");
  if (!/^[A-Za-z][\w:.-]*$/u.test(label))
    throw new SchemaParseError(
      "invalid-block-data",
      "label must be a stable identifier.",
    );
  return { label };
}

function resource(value: unknown, label: string): DownloadableResource {
  const data = record(value, label);
  return {
    src: string(data["src"], `${label}.src`),
    ...(typeof data["mediaType"] === "string"
      ? { mediaType: data["mediaType"] }
      : {}),
    ...(typeof data["filename"] === "string"
      ? { filename: data["filename"] }
      : {}),
  };
}

export const paragraphDefinition = definePortableBlock({
  type: "publisle:paragraph",
  contract: builtinContractSource("paragraph"),
  traversal: coreTraversal("paragraph"),
  schemaVersion: 1,
  schema: {
    parse(value): ParagraphData {
      const data = record(value, "paragraph");
      return { content: inlineNodes(data["content"]) };
    },
  },
});
export const headingDefinition = definePortableBlock({
  type: "publisle:heading",
  contract: builtinContractSource("heading"),
  traversal: coreTraversal("heading"),
  schemaVersion: 1,
  schema: {
    parse(value): HeadingData {
      const data = record(value, "heading");
      const level = Number(data["level"]);
      if (![1, 2, 3, 4, 5, 6].includes(level))
        throw new SchemaParseError(
          "invalid-block-data",
          "heading.level must be between 1 and 6.",
        );
      const role = data["role"];
      if (role !== undefined && role !== "abstract" && role !== "section")
        throw new SchemaParseError(
          "invalid-block-data",
          "heading.role must be abstract or section.",
        );
      return {
        level: level as HeadingData["level"],
        content: inlineNodes(data["content"]),
        ...optionalLabel(data),
        ...(role === undefined ? {} : { role }),
      };
    },
  },
});
export const listDefinition = definePortableBlock({
  type: "publisle:list",
  contract: builtinContractSource("list"),
  traversal: coreTraversal("list"),
  schemaVersion: 1,
  schema: {
    parse(value): ListData {
      const data = record(value, "list");
      if (!Array.isArray(data["items"]))
        throw new SchemaParseError(
          "invalid-block-data",
          "list.items must be an array.",
        );
      return {
        ordered: booleanValue(data["ordered"], "list.ordered", false),
        ...(typeof data["start"] === "number" &&
        Number.isInteger(data["start"]) &&
        data["start"] >= 1
          ? { start: data["start"] }
          : {}),
        items: listItems(data["items"], "list.items"),
      };
    },
  },
});
export const quoteDefinition = definePortableBlock({
  type: "publisle:quote",
  contract: builtinContractSource("quote"),
  traversal: coreTraversal("quote"),
  schemaVersion: 1,
  schema: {
    parse(value): QuoteData {
      return { children: flowNodes(record(value, "quote")["children"]) };
    },
  },
});
export const codeDefinition = definePortableBlock({
  type: "publisle:code",
  contract: builtinContractSource("code"),
  traversal: coreTraversal("code"),
  schemaVersion: 1,
  schema: {
    parse(value): CodeData {
      const data = record(value, "code");
      return {
        value: string(data["value"], "code.value"),
        ...(typeof data["language"] === "string"
          ? { language: data["language"] }
          : {}),
        ...(typeof data["meta"] === "string" ? { meta: data["meta"] } : {}),
      };
    },
  },
});
export const mathDefinition = definePortableBlock({
  type: "publisle:math",
  contract: builtinContractSource("math"),
  traversal: coreTraversal("math"),
  schemaVersion: 1,
  schema: {
    parse(value): MathData {
      const data = record(value, "math");
      return {
        value: string(data["value"], "math.value"),
        display: booleanValue(data["display"], "math.display", false),
        ...optionalLabel(data),
      };
    },
  },
});
export const figureDefinition = definePortableBlock({
  type: "publisle:figure",
  contract: builtinContractSource("figure"),
  traversal: coreTraversal("figure"),
  schemaVersion: 1,
  schema: {
    parse(value): FigureData {
      const data = record(value, "figure");
      return {
        src: string(data["src"], "figure.src"),
        ...(data["alt"] === undefined
          ? {}
          : { alt: string(data["alt"], "figure.alt") }),
        ...optionalVariants(data),
        ...optionalString(data, "title"),
        ...optionalLabel(data),
        ...(data["caption"] === undefined
          ? {}
          : { caption: flowNodes(data["caption"], "figure.caption") }),
        ...(data["credit"] === undefined
          ? {}
          : { credit: inlineNodes(data["credit"], "figure.credit") }),
        ...(data["original"] === undefined
          ? {}
          : { original: resource(data["original"], "figure.original") }),
      };
    },
  },
});
export const tableDefinition = definePortableBlock({
  type: "publisle:table",
  contract: builtinContractSource("table"),
  traversal: coreTraversal("table"),
  schemaVersion: 1,
  schema: {
    parse(value): TableData {
      const data = record(value, "table");
      if (!Array.isArray(data["rows"]) || !Array.isArray(data["align"]))
        throw new SchemaParseError(
          "invalid-block-data",
          "table rows and align must be arrays.",
        );
      const alignValues = data["align"] as unknown[];
      const rows = data["rows"] as unknown[];
      const align = alignValues.map((entry, index) => {
        if (
          entry === "left" ||
          entry === "right" ||
          entry === "center" ||
          entry === null
        )
          return entry;
        throw new SchemaParseError(
          "invalid-block-data",
          `table.align[${index}] must be left, right, center, or null.`,
        );
      });
      return {
        align,
        rows: rows.map((row, rowIndex) => {
          if (!Array.isArray(row))
            throw new SchemaParseError(
              "invalid-block-data",
              `table.rows[${rowIndex}] must be an array.`,
            );
          const cells = row as unknown[];
          return cells.map((cell, cellIndex) =>
            inlineNodes(cell, `table.rows[${rowIndex}][${cellIndex}]`),
          );
        }),
        ...optionalLabel(data),
        ...(data["caption"] === undefined
          ? {}
          : { caption: flowNodes(data["caption"], "table.caption") }),
        ...headerRows(data, rows.length),
      };
    },
  },
});
export const embedDefinition = definePortableBlock({
  type: "publisle:embed",
  contract: builtinContractSource("embed"),
  traversal: coreTraversal("embed"),
  schemaVersion: 1,
  schema: {
    parse(value): EmbedData {
      const data = record(value, "embed");
      const ratio = record(data["aspectRatio"], "embed.aspectRatio");
      const width = Number(ratio["width"]);
      const height = Number(ratio["height"]);
      if (!(width > 0) || !(height > 0))
        throw new SchemaParseError(
          "invalid-block-data",
          "embed.aspectRatio dimensions must be positive.",
        );
      return {
        provider: nonemptyString(data["provider"], "embed.provider"),
        resourceId: nonemptyString(data["resourceId"], "embed.resourceId"),
        title: nonemptyString(data["title"], "embed.title"),
        aspectRatio: { width, height },
        ...(data["caption"] === undefined
          ? {}
          : { caption: flowNodes(data["caption"], "embed.caption") }),
        ...(data["fallback"] === undefined
          ? {}
          : { fallback: flowNodes(data["fallback"], "embed.fallback") }),
      };
    },
  },
});
export const diagramDefinition = definePortableBlock({
  type: "publisle:diagram",
  contract: builtinContractSource("diagram"),
  traversal: coreTraversal("diagram"),
  schemaVersion: 1,
  schema: {
    parse(value): DiagramData {
      const data = record(value, "diagram");
      const engine = string(data["engine"], "diagram.engine");
      if (
        !["mermaid", "graphviz", "wavedrom", "plantuml"].includes(engine) &&
        !engine.includes(":")
      )
        throw new SchemaParseError(
          "invalid-block-data",
          "Custom diagram engines must be namespaced.",
        );
      return {
        engine: engine as DiagramData["engine"],
        source: string(data["source"], "diagram.source"),
        alt: string(data["alt"], "diagram.alt"),
        ...optionalLabel(data),
        ...(data["caption"] === undefined
          ? {}
          : { caption: flowNodes(data["caption"], "diagram.caption") }),
        ...(data["fallback"] === undefined
          ? {}
          : { fallback: flowNodes(data["fallback"], "diagram.fallback") }),
        ...(data["printFallback"] === undefined
          ? {}
          : {
              printFallback: resource(
                data["printFallback"],
                "diagram.printFallback",
              ),
            }),
      };
    },
  },
});
export const calloutDefinition = definePortableBlock({
  type: "publisle:callout",
  contract: builtinContractSource("callout"),
  traversal: coreTraversal("callout"),
  schemaVersion: 1,
  schema: {
    parse(value): CalloutData {
      const data = record(value, "callout");
      return {
        variant: string(data["variant"] ?? "note", "callout.variant"),
        ...(typeof data["title"] === "string" ? { title: data["title"] } : {}),
        children: flowNodes(data["children"]),
      };
    },
  },
});
export const dividerDefinition = definePortableBlock({
  type: "publisle:divider",
  contract: builtinContractSource("divider"),
  traversal: coreTraversal("divider"),
  schemaVersion: 1,
  schema: {
    parse(value): Record<string, never> {
      record(value, "divider");
      return {};
    },
  },
});
export const footnoteDefinition = definePortableBlock({
  type: "publisle:footnote",
  contract: builtinContractSource("footnote"),
  traversal: coreTraversal("footnote"),
  schemaVersion: 1,
  schema: {
    parse(value): FootnoteData {
      const data = record(value, "footnote");
      return {
        identifier: string(data["identifier"], "footnote.identifier"),
        children: flowNodes(data["children"]),
      };
    },
  },
});
function headerRows(data: Record<string, unknown>, rowCount: number) {
  if (data["headerRows"] === undefined) return {};
  const value = data["headerRows"];
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > rowCount
  )
    throw new SchemaParseError(
      "invalid-block-data",
      "table.headerRows must be an integer from 0 through the row count.",
    );
  return { headerRows: value };
}

export const bibliographyDefinition = definePortableBlock({
  type: "publisle:bibliography",
  contract: builtinContractSource("bibliography"),
  traversal: coreTraversal("bibliography"),
  schemaVersion: 1,
  schema: {
    parse(value): BibliographyData {
      const data = record(value, "bibliography");
      if (!Array.isArray(data["entries"]))
        throw new SchemaParseError(
          "invalid-block-data",
          "bibliography.entries must be an array.",
        );
      return {
        entries: data["entries"].map((entry, index) => {
          const item = record(entry, `bibliography.entries[${index}]`);
          const authors = item["authors"];
          if (
            authors !== undefined &&
            (!Array.isArray(authors) ||
              authors.some((author) => typeof author !== "string"))
          )
            throw new SchemaParseError(
              "invalid-block-data",
              `bibliography.entries[${index}].authors must be an array of strings.`,
            );
          const label = `bibliography.entries[${index}]`;
          const optional = (key: string) => {
            if (!Object.hasOwn(item, key)) return undefined;
            const field = item[key];
            if (typeof field !== "string")
              throw new SchemaParseError(
                "invalid-block-data",
                `${label}.${key} must be a string.`,
              );
            return field;
          };
          const type = optional("type");
          const title = optional("title");
          const issued = optional("issued");
          const containerTitle = optional("containerTitle");
          const volume = optional("volume");
          const issue = optional("issue");
          const page = optional("page");
          const publisher = optional("publisher");
          const edition = optional("edition");
          const doi = optional("doi");
          const url = optional("url");
          const raw = optional("raw");
          return {
            id: nonemptyString(item["id"], `${label}.id`),
            ...(type === undefined ? {} : { type }),
            ...(title === undefined ? {} : { title }),
            ...(authors === undefined ? {} : { authors: authors as string[] }),
            ...(issued === undefined ? {} : { issued }),
            ...(containerTitle === undefined ? {} : { containerTitle }),
            ...(volume === undefined ? {} : { volume }),
            ...(issue === undefined ? {} : { issue }),
            ...(page === undefined ? {} : { page }),
            ...(publisher === undefined ? {} : { publisher }),
            ...(edition === undefined ? {} : { edition }),
            ...(doi === undefined ? {} : { doi }),
            ...(url === undefined ? {} : { url }),
            ...(raw === undefined ? {} : { raw }),
          };
        }),
      };
    },
  },
});

export const rawHtmlDefinition = definePortableBlock({
  type: "publisle:raw-html",
  contract: builtinContractSource("raw-html"),
  traversal: coreTraversal("raw-html"),
  schemaVersion: 1,
  schema: {
    parse(value): RawHtmlData {
      const data = record(value, "raw-html");
      return {
        value: string(data["value"], "raw-html.value"),
        inline: data["inline"] === true,
      };
    },
  },
});

export const coreBlockDefinitions = [
  paragraphDefinition,
  headingDefinition,
  listDefinition,
  quoteDefinition,
  codeDefinition,
  mathDefinition,
  figureDefinition,
  tableDefinition,
  calloutDefinition,
  dividerDefinition,
  footnoteDefinition,
  bibliographyDefinition,
  rawHtmlDefinition,
  embedDefinition,
  diagramDefinition,
] as const;

// Declarative block editing. The segment API preserves non-text inline nodes
// (citations, references, math) that plain-text editors destroy; field specs
// keep the React and Svelte forms in parity, and every block additionally
// exposes its whole payload as JSON so no data is unreachable from the UI.
import type { PlaygroundExtensions } from "./templates.ts";
import { flowText } from "./editor-core.ts";

export type FieldKind =
  | "text"
  | "textarea"
  | "select"
  | "checkbox"
  | "number"
  | "segments"
  | "flow"
  | "rows"
  | "list"
  | "json";

export interface FieldSpec {
  readonly kind: FieldKind;
  /** Data key. Empty for whole-data JSON editors. */
  readonly key: string;
  readonly label: string;
  readonly rows?: number;
  readonly options?: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly optional?: boolean;
  readonly placeholder?: string;
  readonly hint?: string;
}

const LEVELS = [1, 2, 3, 4, 5, 6].map((level) => ({
  value: String(level),
  label: `H${String(level)}`,
}));

const ENGINES = ["mermaid", "graphviz", "plantuml", "wavedrom"].map(
  (engine) => ({ value: engine, label: engine }),
);

const ACTIVATION = [
  { value: "load", label: "Load" },
  { value: "visible", label: "Visible" },
  { value: "idle", label: "Idle" },
  { value: "interaction", label: "Interaction" },
];

const VARIANTS = [
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "error", label: "Error" },
];

const CODE_LANGUAGES = [
  { value: "", label: "Plain" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "jsx", label: "JSX" },
  { value: "tsx", label: "TSX" },
  { value: "python", label: "Python" },
  { value: "json", label: "JSON" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "bash", label: "Bash" },
  { value: "rust", label: "Rust" },
  { value: "go", label: "Go" },
  { value: "java", label: "Java" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "sql", label: "SQL" },
  { value: "yaml", label: "YAML" },
  { value: "markdown", label: "Markdown" },
];

const omit = (
  data: Record<string, unknown>,
  key: string,
): Record<string, unknown> =>
  Object.fromEntries(Object.entries(data).filter(([entry]) => entry !== key));

const plain = (
  hint = "Edited as plain text; rich inline structure is flattened.",
): string => hint;

/** Field specs per block type. React and Svelte render these identically. */
export function blockFields(
  type: string,
  extensions?: PlaygroundExtensions,
): readonly FieldSpec[] {
  switch (type) {
    case "publisle:paragraph":
      return [{ kind: "segments", key: "content", label: "Content" }];
    case "publisle:heading":
      return [
        { kind: "select", key: "level", label: "Level", options: LEVELS },
        {
          kind: "text",
          key: "label",
          label: "Label (cross-reference target)",
          optional: true,
        },
        { kind: "segments", key: "content", label: "Content" },
      ];
    case "publisle:list":
      return [
        { kind: "checkbox", key: "ordered", label: "Numbered list" },
        { kind: "list", key: "items", label: "Items" },
      ];
    case "publisle:quote":
      return [
        {
          kind: "flow",
          key: "children",
          label: "Quote content",
          rows: 3,
          hint: plain(),
        },
      ];
    case "publisle:code":
      return [
        {
          kind: "select",
          key: "language",
          label: "Language",
          optional: true,
          options: CODE_LANGUAGES,
        },
        { kind: "textarea", key: "value", label: "Code", rows: 5 },
      ];
    case "publisle:math":
      return [
        { kind: "textarea", key: "value", label: "Math expression", rows: 3 },
        { kind: "checkbox", key: "display", label: "Display mode" },
        {
          kind: "text",
          key: "label",
          label: "Label (equation number)",
          optional: true,
        },
      ];
    case "publisle:figure":
      return [
        { kind: "text", key: "src", label: "Image URL" },
        { kind: "textarea", key: "alt", label: "Alt text", rows: 2 },
        {
          kind: "text",
          key: "label",
          label: "Label (cross-reference target)",
          optional: true,
        },
        {
          kind: "flow",
          key: "caption",
          label: "Caption",
          rows: 2,
          hint: plain(),
        },
      ];
    case "publisle:table":
      return [
        {
          kind: "text",
          key: "label",
          label: "Label (cross-reference target)",
          optional: true,
        },
        { kind: "number", key: "headerRows", label: "Header rows" },
        {
          kind: "flow",
          key: "caption",
          label: "Caption",
          rows: 2,
          hint: plain(),
        },
        {
          kind: "rows",
          key: "rows",
          label: "Table rows (cells separated by |)",
          rows: 4,
          hint: plain(),
        },
      ];
    case "publisle:callout":
      return [
        { kind: "select", key: "variant", label: "Variant", options: VARIANTS },
        { kind: "text", key: "title", label: "Title", optional: true },
        {
          kind: "flow",
          key: "children",
          label: "Content",
          rows: 3,
          hint: plain(),
        },
      ];
    case "publisle:divider":
      return [];
    case "publisle:embed":
      return [
        { kind: "text", key: "provider", label: "Provider" },
        { kind: "text", key: "resourceId", label: "Resource ID" },
        {
          kind: "text",
          key: "title",
          label: "Accessible title",
          optional: true,
        },
        {
          kind: "flow",
          key: "caption",
          label: "Caption",
          rows: 2,
          hint: plain(),
        },
        {
          kind: "flow",
          key: "fallback",
          label: "Static fallback",
          rows: 2,
          hint: plain(
            "Shown where the embed cannot run (print, no JavaScript).",
          ),
        },
      ];
    case "publisle:diagram":
      return [
        { kind: "select", key: "engine", label: "Engine", options: ENGINES },
        {
          kind: "text",
          key: "label",
          label: "Label (cross-reference target)",
          optional: true,
        },
        { kind: "textarea", key: "alt", label: "Alt text", rows: 2 },
        { kind: "textarea", key: "source", label: "Diagram source", rows: 5 },
        {
          kind: "flow",
          key: "caption",
          label: "Caption",
          rows: 2,
          hint: plain(),
        },
        {
          kind: "flow",
          key: "fallback",
          label: "Static fallback",
          rows: 2,
          hint: plain("Shown by engines the host does not render."),
        },
      ];
    case "publisle:raw-html":
      return [{ kind: "textarea", key: "value", label: "Raw HTML", rows: 4 }];
    case "publisle:interactive-schematic":
      return [
        {
          kind: "select",
          key: "activation",
          label: "Activation",
          options: ACTIVATION,
        },
      ];
    case "publisle:bibliography":
      return [
        {
          kind: "json",
          key: "entries",
          label: "Bibliography entries (CSL JSON array)",
          rows: 8,
        },
      ];
    default: {
      const extension = extensions?.blocks?.find(
        (block) => block.type === type,
      );
      return extension?.fieldSpecs ?? [];
    }
  }
}

export type FieldValue = string | boolean;

/** Read a field for the form controls (JSON fields come back pretty-printed). */
export function fieldValue(
  data: Record<string, unknown>,
  spec: FieldSpec,
): FieldValue {
  const value = spec.key === "" ? data : data[spec.key];
  switch (spec.kind) {
    case "checkbox":
      return value === true;
    case "number":
      return value === undefined || value === null ? "" : String(value);
    case "json":
      return JSON.stringify(value ?? (spec.key === "" ? {} : null), null, 2);
    case "segments":
      return "";
    default:
      return typeof value === "string"
        ? value
        : value === undefined || value === null
          ? ""
          : String(value);
  }
}

/** Produce updated block data. Optional text fields drop empty values. */
export function setFieldValue(
  data: Record<string, unknown>,
  spec: FieldSpec,
  value: FieldValue,
): Record<string, unknown> {
  if (spec.kind === "json")
    throw new Error("JSON fields are written through setFieldJson.");
  const next: Record<string, unknown> = { ...data };
  if (spec.kind === "checkbox") {
    next[spec.key] = value === true;
    return next;
  }
  if (spec.kind === "number") {
    const parsed = Number(String(value).trim());
    if (String(value).trim() === "" || !Number.isInteger(parsed))
      return omit(next, spec.key);
    next[spec.key] = parsed;
    return next;
  }
  if (spec.optional && String(value).trim() === "") return omit(next, spec.key);
  if (spec.kind === "segments")
    throw new Error("Segment fields are written through the segment helpers.");
  next[spec.key] = value;
  return next;
}

/** Write a parsed JSON field value (bibliography entries, whole payload). */
export function setFieldJson(
  data: Record<string, unknown>,
  spec: FieldSpec,
  parsed: unknown,
): Record<string, unknown> {
  if (spec.key === "") return parsed as Record<string, unknown>;
  return { ...data, [spec.key]: parsed };
}

// --- Inline segments -------------------------------------------------------

export interface InlineSegment {
  readonly index: number;
  readonly kind: string;
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly url?: string;
}

export const SEGMENT_KINDS: readonly {
  readonly value: string;
  readonly label: string;
}[] = [
  { value: "text", label: "Text" },
  { value: "link", label: "Link" },
  { value: "image", label: "Image" },
  { value: "citation", label: "Citation" },
  { value: "math", label: "Inline math" },
  { value: "code", label: "Inline code" },
  { value: "crossReference", label: "Cross-reference" },
  { value: "footnote", label: "Footnote reference" },
];

type AnyNode = Record<string, unknown>;

const asNodes = (nodes: readonly unknown[] | undefined): AnyNode[] =>
  Array.isArray(nodes) ? (nodes as AnyNode[]) : [];

function segmentOf(node: AnyNode, index: number): InlineSegment | undefined {
  switch (node["type"]) {
    case "text":
      return {
        index,
        kind: "text",
        label: "Text",
        value: String(node["value"] ?? ""),
      };
    case "emphasis":
    case "strong":
    case "strikethrough":
      return {
        index,
        kind: node["type"],
        label:
          node["type"] === "strong"
            ? "Bold"
            : node["type"] === "emphasis"
              ? "Emphasis"
              : "Strikethrough",
        value: descendantText(node),
      };
    case "inlineCode":
      return {
        index,
        kind: "inlineCode",
        label: "Inline code",
        value: String(node["value"] ?? ""),
      };
    case "inlineMath":
      return {
        index,
        kind: "inlineMath",
        label: "Inline math",
        value: String(node["value"] ?? ""),
        placeholder: "e^{i\\pi}=-1",
      };
    case "link":
      return {
        index,
        kind: "link",
        label: "Link",
        value: descendantText(node),
        url: String(node["url"] ?? ""),
      };
    case "inlineImage":
      return {
        index,
        kind: "inlineImage",
        label: "Image",
        value: String(node["alt"] ?? ""),
        url: String(node["url"] ?? ""),
      };
    case "citationReference": {
      const items = Array.isArray(node["items"]) ? node["items"] : [];
      return {
        index,
        kind: "citation",
        label: "Citation",
        value: items
          .map((item) => String((item as AnyNode)["id"] ?? ""))
          .join("; "),
        placeholder: "shannon1949; gibbs1899",
      };
    }
    case "footnoteReference":
      return {
        index,
        kind: "footnote",
        label: "Footnote reference",
        value: String(node["identifier"] ?? ""),
      };
    case "crossReference":
      return {
        index,
        kind: "crossReference",
        label: "Cross-reference",
        value: String(node["target"] ?? ""),
        placeholder: "eq:error",
      };
    case "hardBreak":
    case "softBreak":
    case "rawHtml":
      return undefined;
    default:
      return undefined;
  }
}

function descendantText(node: AnyNode): string {
  const children = node["children"] ?? node["content"];
  if (!Array.isArray(children))
    return typeof node["value"] === "string" ? node["value"] : "";
  return children
    .map((child) => {
      const item = child as AnyNode;
      if (typeof item["value"] === "string") return item["value"];
      return descendantText(item);
    })
    .join("");
}

/** Flattened editable inline segments; unlisted node kinds are preserved as-is. */
export function inlineSegments(
  nodes: readonly unknown[] | undefined,
): InlineSegment[] {
  const segments: InlineSegment[] = [];
  asNodes(nodes).forEach((node, index) => {
    const segment = segmentOf(node, index);
    if (segment) segments.push(segment);
  });
  return segments;
}

function withDescendantText(
  node: AnyNode,
  value: string,
  state: { done: boolean },
): AnyNode {
  if (state.done) return node;
  if (node["type"] === "text") {
    state.done = true;
    return { ...node, value };
  }
  const key = "children" in node ? "children" : "content";
  const children = node[key];
  if (!Array.isArray(children)) return node;
  return {
    ...node,
    [key]: children.map((child) =>
      withDescendantText(child as AnyNode, value, state),
    ),
  };
}

/** Update one segment without disturbing sibling inline nodes. */
export function setSegmentText(
  nodes: readonly unknown[] | undefined,
  index: number,
  value: string,
): unknown[] {
  const next = asNodes(nodes).map((node, position) => {
    if (position !== index) return node;
    switch (node["type"]) {
      case "text":
      case "inlineCode":
      case "inlineMath":
      case "rawHtml":
        return { ...node, value };
      case "citationReference":
        return {
          ...node,
          items: value
            .split(";")
            .map((id) => id.trim())
            .filter((id) => id.length > 0)
            .map((id) => ({ id })),
        };
      case "footnoteReference":
        return { ...node, identifier: value };
      case "crossReference":
        return { ...node, target: value };
      case "inlineImage":
        return { ...node, alt: value };
      case "emphasis":
      case "strong":
      case "strikethrough":
      case "link":
        return withDescendantText(node, value, { done: false });
      default:
        return node;
    }
  });
  return next;
}

/** Append a new inline node of the given kind. */
export function appendSegment(
  nodes: readonly unknown[] | undefined,
  kind: string,
): unknown[] {
  const next = [...asNodes(nodes)];
  if (kind === "text") next.push({ type: "text", value: " " });
  else if (kind === "link")
    next.push({
      type: "link",
      url: "https://example.com",
      children: [{ type: "text", value: "link text" }],
    });
  else if (kind === "image")
    next.push({
      type: "inlineImage",
      url: "https://example.com/image.png",
      alt: "Description",
    });
  else if (kind === "citation")
    next.push({ type: "citationReference", items: [{ id: "citation-id" }] });
  else if (kind === "math")
    next.push({ type: "inlineMath", value: "e^{i\\pi}=-1" });
  else if (kind === "code") next.push({ type: "inlineCode", value: "code" });
  else if (kind === "crossReference")
    next.push({ type: "crossReference", target: "fig:figure" });
  else if (kind === "footnote")
    next.push({ type: "footnoteReference", identifier: "note-1" });
  return next;
}

export function removeSegment(
  nodes: readonly unknown[] | undefined,
  index: number,
): unknown[] {
  return asNodes(nodes).filter((_, position) => position !== index);
}

/** List items rendered as one plain-text line each. */
export function listText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  return items
    .map((item) =>
      flowText(
        (item as AnyNode)["children"] as readonly {
          readonly type: string;
          readonly content?: readonly {
            readonly type: string;
            readonly value?: string;
          }[];
        }[],
      ),
    )
    .join("\n");
}

export function setSegmentUrl(
  nodes: readonly unknown[] | undefined,
  index: number,
  url: string,
): unknown[] {
  return asNodes(nodes).map((node, position) => {
    if (position !== index) return node;
    if (node["type"] === "link" || node["type"] === "inlineImage")
      return { ...node, url };
    return node;
  });
}

export interface ListItemEdit {
  readonly index: number;
  readonly text: string;
  readonly checked: boolean | undefined;
}

/** One editor row per list item. Plain text is what the row shows. */
export function listItemEdits(items: unknown): ListItemEdit[] {
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => {
    const node = (item ?? {}) as AnyNode;
    const checked =
      typeof node["checked"] === "boolean" ? node["checked"] : undefined;
    return {
      index,
      text: flowText(node["children"] as Parameters<typeof flowText>[0]),
      checked,
    };
  });
}

function listCopy(items: unknown): AnyNode[] {
  return Array.isArray(items)
    ? (items as AnyNode[]).map((item) => ({ ...(item as AnyNode) }))
    : [];
}

/** Replace one item's text. An unchanged string keeps links, math, and images. */
export function updateListItemText(
  items: unknown,
  index: number,
  text: string,
): unknown[] {
  const list = listCopy(items);
  const current = list[index] ?? { type: "listItem" };
  if (flowText(current["children"] as Parameters<typeof flowText>[0]) === text)
    return list;
  list[index] = {
    ...current,
    type: "listItem",
    children: [{ type: "paragraph", content: [{ type: "text", value: text }] }],
  };
  return list;
}

export function updateListItemChecked(
  items: unknown,
  index: number,
  checked: boolean,
): unknown[] {
  const list = listCopy(items);
  const current = list[index] ?? { type: "listItem", children: [] };
  if (!checked && typeof current["checked"] !== "boolean") return list;
  list[index] = { ...current, type: "listItem", checked };
  return list;
}

export function removeListItem(items: unknown, index: number): unknown[] {
  return listCopy(items).filter((_, position) => position !== index);
}

export function insertListItem(items: unknown, index: number): unknown[] {
  const list = listCopy(items);
  list.splice(index + 1, 0, {
    type: "listItem",
    children: [{ type: "paragraph", content: [{ type: "text", value: "" }] }],
  });
  return list;
}

/** Rebuild simple list items from one-line-per-item text. */
export function setListText(value: string): unknown[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => ({
      type: "listItem",
      children: [
        { type: "paragraph", content: [{ type: "text", value: line }] },
      ],
    }));
}

// --- Document metadata -----------------------------------------------------

export interface AuthorRow {
  readonly name: string;
  readonly affiliation: string;
}

type Meta = unknown;

function metaRecord(metadata: Meta): Record<string, unknown> {
  return (metadata ?? {}) as Record<string, unknown>;
}

export function metadataField(metadata: Meta, key: string): string {
  const value = metaRecord(metadata)[key];
  return typeof value === "string" ? value : "";
}

export function metadataSubjects(metadata: Meta): string {
  const value = metaRecord(metadata)["subjects"];
  return Array.isArray(value)
    ? value.map((entry) => String(entry)).join(", ")
    : "";
}

export function metadataAuthors(metadata: Meta): AuthorRow[] {
  const value = metaRecord(metadata)["authors"];
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const author = (entry ?? {}) as AnyNode;
    return {
      name: String(author["name"] ?? ""),
      affiliation: String(author["affiliation"] ?? ""),
    };
  });
}

/** Rebuild metadata with one top-level string field replaced or removed. */
export function withMetadataField(
  metadata: Meta,
  key: string,
  value: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = metaRecord(metadata);
  if (value.trim() === "") return omit(base, key);
  base[key] = value;
  return base;
}

export function withMetadataSubjects(
  metadata: Meta,
  csv: string,
): Record<string, unknown> {
  const base = withMetadataField(metadata, "subjects", "");
  const subjects = csv
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (subjects.length > 0) base["subjects"] = subjects;
  else return omit(base, "subjects");
  return base;
}

export function withMetadataAuthors(
  metadata: Meta,
  rows: readonly AuthorRow[],
): Record<string, unknown> {
  const base = withMetadataField(metadata, "authors", "");
  const authors = rows
    .map((row) => ({
      ...(row.name.trim() === "" ? {} : { name: row.name.trim() }),
      ...(row.affiliation.trim() === ""
        ? {}
        : { affiliation: row.affiliation.trim() }),
    }))
    .filter((author) => Object.keys(author).length > 0);
  if (authors.length > 0) base["authors"] = authors;
  else return omit(base, "authors");
  return base;
}

import { isPlainObject } from "./object.ts";
import { canonicalizeJson } from "./canonical.ts";

/** A data-only tree program. Property names are literal, never selectors. */
export interface TraversalRule {
  readonly optional?: boolean;
  readonly emit?: {
    readonly kind: "node" | "reference" | "resource";
    readonly type?: string;
  };
  readonly properties?: Readonly<Record<string, TraversalRule>>;
  readonly items?: TraversalRule;
  readonly tag?: {
    readonly property: string;
    readonly cases: Readonly<Record<string, TraversalRule>>;
  };
  readonly ref?: string;
}
export interface TraversalDeclaration {
  readonly root: TraversalRule;
  readonly rules?: Readonly<Record<string, TraversalRule>>;
}
export interface TraversalVisit {
  readonly pointer: string;
  readonly kind: "node" | "reference" | "resource" | "unresolved";
  readonly type?: string;
  readonly value: unknown;
}
export class TraversalError extends Error {
  readonly pointer: string;
  constructor(message: string, pointer = "") {
    super(message);
    this.name = "TraversalError";
    this.pointer = pointer;
  }
}
export function pointerToken(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
/** Fixed RFC 6901 pointer. Own properties only; array indexes must be canonical. */
export function resolvePointer(
  value: unknown,
  pointer: string,
): { readonly found: boolean; readonly value?: unknown } {
  if (
    typeof pointer !== "string" ||
    (pointer !== "" && !pointer.startsWith("/")) ||
    /~(?![01])/u.test(pointer)
  )
    throw new TraversalError("Invalid fixed JSON Pointer.", pointer);
  for (const encoded of pointer === "" ? [] : pointer.slice(1).split("/")) {
    const key = encoded.replaceAll("~1", "/").replaceAll("~0", "~");
    if (
      key === "*" ||
      key === "-" ||
      (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/u.test(key))
    )
      throw new TraversalError(
        "Selectors and noncanonical array indexes are not supported.",
        pointer,
      );
    if (
      (!isPlainObject(value) && !Array.isArray(value)) ||
      !Object.hasOwn(value, key)
    )
      return { found: false };
    value = (value as Record<string, unknown>)[key];
  }
  return { found: true, value };
}

/** Validate without running plugin code. Limits also bound ref expansion at evaluation. */
export function validateTraversal(declaration: TraversalDeclaration): void {
  canonicalizeJson(declaration); // Reject accessors, executable hooks, cycles and oversized programs without invoking them.
  if (
    !isPlainObject(declaration) ||
    !isPlainObject(declaration.root) ||
    Object.keys(declaration).some((key) => key !== "root" && key !== "rules") ||
    (declaration.rules !== undefined && !isPlainObject(declaration.rules))
  )
    throw new TraversalError("Invalid traversal declaration.");
  let count = 0;
  const check = (rule: unknown, depth: number): void => {
    if (++count > 4096 || depth > 64)
      throw new TraversalError("Traversal declaration limit exceeded.");
    if (
      !isPlainObject(rule) ||
      Object.keys(rule).some(
        (key) =>
          !["optional", "emit", "properties", "items", "tag", "ref"].includes(
            key,
          ),
      )
    )
      throw new TraversalError("Invalid traversal rule.");
    if (rule["optional"] !== undefined && typeof rule["optional"] !== "boolean")
      throw new TraversalError("Invalid optional branch.");
    if (
      rule["ref"] !== undefined &&
      (typeof rule["ref"] !== "string" ||
        !declaration.rules ||
        !Object.hasOwn(declaration.rules, rule["ref"]))
    )
      throw new TraversalError("Unknown traversal rule reference.");
    if (
      rule["emit"] !== undefined &&
      (!isPlainObject(rule["emit"]) ||
        !["node", "reference", "resource"].includes(
          String(rule["emit"]["kind"]),
        ) ||
        (rule["emit"]["type"] !== undefined &&
          typeof rule["emit"]["type"] !== "string") ||
        Object.keys(rule["emit"]).some(
          (key) => key !== "kind" && key !== "type",
        ))
    )
      throw new TraversalError("Invalid traversal emission.");
    if (rule["properties"] !== undefined) {
      if (!isPlainObject(rule["properties"]))
        throw new TraversalError("Invalid traversal properties.");
      for (const [key, child] of Object.entries(rule["properties"])) {
        if (key === "*" || key === "-")
          throw new TraversalError("Traversal properties cannot be selectors.");
        check(child, depth + 1);
      }
    }
    if (rule["items"] !== undefined) check(rule["items"], depth + 1);
    if (rule["tag"] !== undefined) {
      if (
        !isPlainObject(rule["tag"]) ||
        typeof rule["tag"]["property"] !== "string" ||
        !isPlainObject(rule["tag"]["cases"]) ||
        Object.keys(rule["tag"]).some(
          (key) => key !== "property" && key !== "cases",
        )
      )
        throw new TraversalError("Invalid tagged union.");
      for (const child of Object.values(rule["tag"]["cases"]))
        check(child, depth + 1);
    }
  };
  check(declaration.root, 0);
  for (const rule of Object.values(declaration.rules ?? {})) check(rule, 0);
}

/** Unknown union cases are deliberately not visited. Atomic: no partial output on failure. */
export function traverseDeclared(
  value: unknown,
  declaration: TraversalDeclaration,
): readonly TraversalVisit[] {
  validateTraversal(declaration);
  return evaluateTraversal(value, declaration);
}

/** Validate and own a declaration once for a series of independent evaluations. */
export function compileTraversal(
  declaration: TraversalDeclaration,
): (value: unknown) => readonly TraversalVisit[] {
  validateTraversal(declaration);
  const snapshot = structuredClone(declaration);
  return (value) => evaluateTraversal(value, snapshot);
}

function evaluateTraversal(
  value: unknown,
  declaration: TraversalDeclaration,
): readonly TraversalVisit[] {
  canonicalizeJson(value);
  const output: TraversalVisit[] = [];
  let steps = 0;
  const visit = (
    value: unknown,
    rule: TraversalRule,
    pointer: string,
    depth: number,
  ): void => {
    if (++steps > 100_000 || depth > 128)
      throw new TraversalError("Traversal evaluation limit exceeded.", pointer);
    if (value === undefined && rule.optional) return;
    if (value === undefined)
      throw new TraversalError(
        "Required traversal location is missing.",
        pointer,
      );
    if (rule.ref) {
      const target = declaration.rules?.[rule.ref];
      if (!target)
        throw new TraversalError("Unknown traversal reference.", pointer);
      visit(value, target, pointer, depth + 1);
    }
    if (rule.emit) output.push({ ...rule.emit, pointer, value });
    if (rule.properties) {
      if (!isPlainObject(value))
        throw new TraversalError(
          "Expected object at traversal location.",
          pointer,
        );
      for (const [key, child] of Object.entries(rule.properties))
        visit(
          Object.hasOwn(value, key) ? value[key] : undefined,
          child,
          `${pointer}/${pointerToken(key)}`,
          depth + 1,
        );
    }
    if (rule.items) {
      if (!Array.isArray(value))
        throw new TraversalError(
          "Expected array at traversal location.",
          pointer,
        );
      for (const [index, entry] of value.entries())
        visit(entry, rule.items, `${pointer}/${String(index)}`, depth + 1);
    }
    if (rule.tag) {
      if (!isPlainObject(value))
        throw new TraversalError("Expected tagged object.", pointer);
      const tag = value[rule.tag.property];
      if (typeof tag !== "string")
        throw new TraversalError("Missing string union tag.", pointer);
      const branch = Object.hasOwn(rule.tag.cases, tag)
        ? rule.tag.cases[tag]
        : undefined;
      if (branch) visit(value, branch, pointer, depth + 1);
      else output.push({ kind: "unresolved", type: tag, pointer, value });
    }
  };
  visit(value, declaration.root, "", 0);
  return output;
}

const inlineArray: TraversalRule = { items: { ref: "inline" } };
const flowArray: TraversalRule = { items: { ref: "flow" } };
const node = (
  type: string,
  properties?: Readonly<Record<string, TraversalRule>>,
): TraversalRule => ({
  emit: { kind: "node", type },
  ...(properties ? { properties } : {}),
});
/** Shared recursive content vocabulary, not a heuristic scan of arbitrary JSON. */
export const RICH_TRAVERSAL_RULES: Readonly<Record<string, TraversalRule>> = {
  inline: {
    tag: {
      property: "type",
      cases: {
        text: node("text"),
        inlineCode: node("inlineCode"),
        inlineMath: node("inlineMath"),
        hardBreak: node("hardBreak"),
        softBreak: node("softBreak"),
        rawHtml: node("rawHtml"),
        emphasis: node("emphasis", { children: inlineArray }),
        strong: node("strong", { children: inlineArray }),
        strikethrough: node("strikethrough", { children: inlineArray }),
        link: node("link", { children: inlineArray }),
        inlineImage: node("inlineImage", {
          url: { emit: { kind: "resource" } },
        }),
        crossReference: {
          emit: { kind: "reference", type: "crossReference" },
          properties: { children: { ...inlineArray, optional: true } },
        },
        footnoteReference: {
          emit: { kind: "reference", type: "footnoteReference" },
        },
        citationReference: {
          emit: { kind: "reference", type: "citationReference" },
        },
      },
    },
  },
  flow: {
    tag: {
      property: "type",
      cases: {
        paragraph: node("paragraph", { content: inlineArray }),
        heading: node("heading", { content: inlineArray }),
        quote: node("quote", { children: flowArray }),
        list: node("list", { items: { items: { ref: "listItem" } } }),
        code: node("code"),
        divider: node("divider"),
        rawHtml: node("rawHtml"),
      },
    },
  },
  listItem: {
    tag: {
      property: "type",
      cases: {
        listItem: node("listItem", { children: flowArray }),
        taskListItem: node("taskListItem", { children: flowArray }),
      },
    },
  },
};

/** All portable prose slots are explicit and optional. Payload remains opaque. */
export const EXPLANATION_TRAVERSAL: TraversalRule = {
  properties: {
    title: { ...inlineArray, optional: true },
    ...Object.fromEntries(
      [
        "description",
        "instructions",
        "purpose",
        "observations",
        "assumptions",
        "fallback",
      ].map((key) => [key, { ...flowArray, optional: true }]),
    ),
    presets: {
      optional: true,
      items: {
        emit: { kind: "reference", type: "preset" },
        properties: { description: { ...flowArray, optional: true } },
      },
    },
  },
};
export const INTERACTIVE_TRAVERSAL: TraversalDeclaration = {
  root: {
    properties: {
      content: { ...EXPLANATION_TRAVERSAL, optional: true },
      fallback: { ...flowArray, optional: true },
    },
  },
  rules: RICH_TRAVERSAL_RULES,
};

/** Plain text of declared inline/flow content only. Never executes raw HTML. */
export function richText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .map((entry: unknown): string => {
      if (!isPlainObject(entry)) return "";
      switch (entry["type"]) {
        case "text":
        case "inlineCode":
        case "inlineMath":
        case "code":
          return typeof entry["value"] === "string" ? entry["value"] : "";
        case "inlineImage":
          return typeof entry["alt"] === "string" ? entry["alt"] : "";
        case "hardBreak":
        case "softBreak":
          return " ";
        case "paragraph":
        case "heading":
          return richText(entry["content"]);
        case "emphasis":
        case "strong":
        case "strikethrough":
        case "link":
        case "crossReference":
        case "quote":
        case "listItem":
        case "taskListItem":
          return richText(entry["children"]);
        case "list":
          return richText(entry["items"]);
        default:
          return "";
      }
    })
    .join("");
}

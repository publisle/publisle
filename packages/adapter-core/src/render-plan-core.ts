import {
  isInteractiveEnvelope,
  locateDiagnostic,
  type Block,
  type BlockType,
  type Diagnostic,
  type InteractiveEnvelope,
  type JsonValue,
  type PreparedDocument,
  type ReferenceTarget,
  type InteractiveContent,
  type ContractDependency,
  richText,
  createIslandInput,
} from "@publisle/schema";
let mathRenderer: typeof import("katex").default | undefined;
/** Install the shared renderer after a host explicitly loads math support. */
export function installMathRenderer(
  renderer: typeof import("katex").default,
): void {
  mathRenderer = renderer;
}

import { highlightCode } from "./highlight.ts";
import type {
  AdapterCompilerOptions,
  IslandRendererReference,
  RenderNode,
  RenderPlan,
} from "./types.ts";

type Inline = { type: string; [key: string]: unknown };
type Flow = { type: string; [key: string]: unknown };
const text = (value: string): RenderNode => ({ kind: "text", value });
const element = (
  tag: string,
  attributes: Record<string, string | number | boolean>,
  children: readonly RenderNode[],
): RenderNode => ({ kind: "element", tag, attributes, children });

/** Stable identity for a citation cluster, independent of object property order. */
export function citationKey(cluster: {
  readonly items: readonly {
    readonly id: string;
    readonly locator?: string;
    readonly label?: string;
    readonly suppressAuthor?: boolean;
  }[];
  readonly prefix?: string;
  readonly suffix?: string;
}): string {
  return JSON.stringify([
    cluster.items.map((item) => [
      item.id,
      item.locator ?? "",
      item.label ?? "",
      item.suppressAuthor ?? false,
    ]),
    cluster.prefix ?? "",
    cluster.suffix ?? "",
  ]);
}

function referenceText(target: ReferenceTarget): string {
  if (target.kind === "heading") return target.title ?? target.label;
  const name = target.kind.charAt(0).toUpperCase() + target.kind.slice(1);
  return `${name} ${target.ordinal ?? ""}`.trim();
}

function renderMath(
  value: string,
  display: boolean,
  diagnostics: Diagnostic[],
  block: Block<BlockType, unknown>,
): RenderNode[] {
  try {
    return [
      {
        kind: "raw",
        value: mathRenderer!.renderToString(value, {
          displayMode: display,
          throwOnError: true,
          trust: false,
          strict: "warn",
          maxExpand: 1000,
          maxSize: 100,
          output: "htmlAndMathml",
        }),
      },
    ];
  } catch (error) {
    diagnostics.push({
      level: "warning",
      code: "invalid-math",
      message:
        error instanceof Error ? error.message : "Math rendering failed.",
      blockId: block.id,
    });
    return [
      element(display ? "pre" : "code", { class: "publisle-math-error" }, [
        text(value),
      ]),
    ];
  }
}

function safeUrl(url: string): string | undefined {
  // Conservative superset of browser URL preprocessing, shared with Python.
  // Browsers remove embedded TAB/LF/CR before identifying a scheme.
  // eslint-disable-next-line no-control-regex -- deliberately remove URL control characters
  const normalized = url.replace(/[\u0000-\u0020]/gu, "").toLowerCase();
  return /^(?:javascript|vbscript|data):/u.test(normalized) ? undefined : url;
}

function safeEmbedUrl(url: string): string | undefined {
  return /^https:\/\//iu.test(url.trim()) ? url : undefined;
}

const builtinEmbedProviders = {
  youtube: (resourceId: string) => {
    return /^[\w-]{6,20}$/u.test(resourceId)
      ? {
          src: `https://www.youtube-nocookie.com/embed/${resourceId}`,
          allow: "accelerometer; autoplay; encrypted-media; picture-in-picture",
          allowFullscreen: true,
        }
      : undefined;
  },
  vimeo: (resourceId: string) => {
    return /^\d+$/u.test(resourceId)
      ? {
          src: `https://player.vimeo.com/video/${resourceId}`,
          allow: "autoplay; fullscreen; picture-in-picture",
          allowFullscreen: true,
        }
      : undefined;
  },
} as const;

function inline(
  nodes: readonly Inline[],
  diagnostics: Diagnostic[],
  block: Block<BlockType, unknown>,
  references: readonly ReferenceTarget[] = [],
): RenderNode[] {
  return nodes.flatMap((node, index): RenderNode[] => {
    switch (node.type) {
      case "text": {
        const value = String(node["value"] ?? "");
        const direction = node["direction"];
        if (direction === "ltr" || direction === "rtl" || direction === "auto")
          return [element("span", { dir: direction }, [text(value)])];
        return [text(value)];
      }
      case "emphasis":
        return [
          element(
            "em",
            {},
            inline(
              node["children"] as Inline[],
              diagnostics,
              block,
              references,
            ),
          ),
        ];
      case "strong":
        return [
          element(
            "strong",
            {},
            inline(
              node["children"] as Inline[],
              diagnostics,
              block,
              references,
            ),
          ),
        ];
      case "strikethrough":
        return [
          element(
            "del",
            {},
            inline(
              node["children"] as Inline[],
              diagnostics,
              block,
              references,
            ),
          ),
        ];
      case "inlineCode":
        return [element("code", {}, [text(String(node["value"] ?? ""))])];
      case "inlineMath":
        return renderMath(
          String(node["value"] ?? ""),
          false,
          diagnostics,
          block,
        );
      case "hardBreak":
        return [element("br", {}, [])];
      case "softBreak":
        return [text("\n")];
      case "footnoteReference": {
        const localId = `footnote-${String(node["identifier"] ?? "")}`;
        return [
          element("sup", {}, [
            element(
              "a",
              { href: `#${localId}`, "data-publisle-ref": localId },
              [text(String(node["identifier"] ?? ""))],
            ),
          ]),
        ];
      }
      case "citationReference": {
        const items = Array.isArray(node["items"])
          ? (node["items"] as Record<string, unknown>[])
          : [];
        const value = `${String(node["prefix"] ?? "")}${items
          .map((item) => {
            const id = String(item["id"] ?? "");
            const locator =
              typeof item["locator"] === "string" ? `, ${item["locator"]}` : "";
            return `${id}${locator}`;
          })
          .join("; ")}${String(node["suffix"] ?? "")}`;
        return [
          element(
            "span",
            {
              class: "publisle-citation",
              "data-publisle-citation": JSON.stringify(items),
              ...(node["prefix"]
                ? { "data-publisle-citation-prefix": String(node["prefix"]) }
                : {}),
              ...(node["suffix"]
                ? { "data-publisle-citation-suffix": String(node["suffix"]) }
                : {}),
            },
            [text(`[${value}]`)],
          ),
        ];
      }
      case "crossReference": {
        const target = String(node["target"] ?? "");
        const resolved = references.find((entry) => entry.label === target);
        const preceding = nodes
          .slice(0, index)
          .map(function plain(item): string {
            return item.type === "text"
              ? String(item["value"] ?? "")
              : Array.isArray(item["children"])
                ? (item["children"] as Inline[]).map(plain).join("")
                : "";
          })
          .join("");
        const kind = resolved?.kind;
        const authoredKind =
          kind &&
          kind !== "heading" &&
          new RegExp(`\\b${kind}\\s+$`, "iu").test(preceding);
        const label = resolved
          ? authoredKind
            ? String(resolved.ordinal ?? resolved.label)
            : referenceText(resolved)
          : target;
        const children = Array.isArray(node["children"])
          ? inline(node["children"] as Inline[], diagnostics, block, references)
          : [text(label)];
        return [
          element(
            "a",
            {
              href: `#reference-${target}`,
              "data-publisle-ref": `reference-${target}`,
              ...(resolved ? {} : { "data-publisle-unresolved": true }),
            },
            children,
          ),
        ];
      }
      case "rawHtml":
        return [
          element("pre", { "data-publisle-raw-html": true }, [
            text(String(node["value"] ?? "")),
          ]),
        ];
      case "link": {
        const url = safeUrl(String(node["url"] ?? ""));
        if (!url)
          diagnostics.push({
            level: "warning",
            code: "unsafe-url",
            message: "An unsafe link URL was removed.",
            blockId: block.id,
          });
        return [
          element(
            "a",
            url ? { href: url } : {},
            inline(
              node["children"] as Inline[],
              diagnostics,
              block,
              references,
            ),
          ),
        ];
      }
      case "inlineImage": {
        const url = safeUrl(String(node["url"] ?? ""));
        if (!url)
          diagnostics.push({
            level: "warning",
            code: "unsafe-url",
            message: "An unsafe image URL was removed.",
            blockId: block.id,
          });
        return [
          element(
            "img",
            { ...(url ? { src: url } : {}), alt: String(node["alt"] ?? "") },
            [],
          ),
        ];
      }
      default:
        return [];
    }
  });
}

function flow(
  nodes: readonly Flow[],
  diagnostics: Diagnostic[],
  block: Block<BlockType, unknown>,
  references: readonly ReferenceTarget[] = [],
): RenderNode[] {
  return nodes.flatMap((node): RenderNode[] => {
    switch (node.type) {
      case "paragraph":
        return [
          element(
            "p",
            {},
            inline(node["content"] as Inline[], diagnostics, block, references),
          ),
        ];
      case "heading":
        return [
          element(
            `h${Number(node["level"])}`,
            {},
            inline(node["content"] as Inline[], diagnostics, block, references),
          ),
        ];
      case "quote":
        return [
          element(
            "blockquote",
            {},
            flow(node["children"] as Flow[], diagnostics, block, references),
          ),
        ];
      case "code": {
        const value = String(node["value"] ?? "");
        const language =
          typeof node["language"] === "string" ? node["language"] : undefined;
        const highlighted = highlightCode(value, language);
        const code = element(
          "code",
          highlighted.className ? { class: highlighted.className } : {},
          highlighted.tokens.map((token) =>
            token.kind === "plain"
              ? text(token.text)
              : element("span", { class: `tok-${token.kind}` }, [
                  text(token.text),
                ]),
          ),
        );
        return [
          element(
            "pre",
            highlighted.label ? { class: "publisle-code" } : {},
            [
              ...(highlighted.label
                ? [
                    element("span", { class: "publisle-code-language" }, [
                      text(highlighted.label),
                    ]),
                  ]
                : []),
              code,
            ],
          ),
        ];
      }
      case "divider":
        return [element("hr", {}, [])];
      case "rawHtml":
        return [
          element("pre", { "data-publisle-raw-html": true }, [
            text(String(node["value"] ?? "")),
          ]),
        ];
      case "list": {
        const ordered = node["ordered"] === true;
        const items = node["items"] as {
          checked?: boolean;
          children: Flow[];
        }[];
        return [
          element(
            ordered ? "ol" : "ul",
            ordered && typeof node["start"] === "number"
              ? { start: node["start"] }
              : {},
            items.map((item) =>
              element(
                "li",
                typeof item.checked === "boolean"
                  ? { class: "publisle-task-list-item" }
                  : {},
                [
                  ...(typeof item.checked === "boolean"
                    ? [
                        element(
                          "input",
                          {
                            type: "checkbox",
                            disabled: true,
                            ...(item.checked ? { checked: true } : {}),
                          },
                          [],
                        ),
                      ]
                    : []),
                  ...flow(item.children, diagnostics, block, references),
                ],
              ),
            ),
          ),
        ];
      }
      default:
        return [];
    }
  });
}

function inlinePlain(nodes: readonly JsonValue[]): string {
  return nodes
    .map((node) => {
      if (typeof node !== "object" || node === null || Array.isArray(node))
        return "";
      const record = node as Record<string, JsonValue>;
      if (record["type"] === "text" && typeof record["value"] === "string")
        return record["value"];
      return Array.isArray(record["children"])
        ? inlinePlain(record["children"])
        : "";
    })
    .join("");
}

function envelopeProps(envelope: InteractiveEnvelope<JsonValue>): JsonValue {
  const props: Record<string, JsonValue> = {
    activation: envelope.activation,
    payload: envelope.payload,
  };
  if (envelope.content !== undefined)
    props["content"] = envelope.content as JsonValue;
  if (envelope.fallback !== undefined) props["fallback"] = envelope.fallback;
  if (envelope.initialState !== undefined)
    props["initialState"] = envelope.initialState;
  if (envelope.accessibility !== undefined)
    props["accessibility"] = envelope.accessibility as JsonValue;
  return props;
}

function nonempty(value: string | undefined, fallback: string): string {
  return value !== undefined && value.length > 0 ? value : fallback;
}

function accessibleName(
  envelope: InteractiveEnvelope<JsonValue>,
  displayName?: string,
): string {
  const title = envelope.content?.title
    ? inlinePlain(envelope.content.title).trim()
    : "";
  return nonempty(
    envelope.accessibility?.label,
    nonempty(title, displayName ?? "Interactive"),
  );
}

function exploreLabel(
  envelope: InteractiveEnvelope<JsonValue>,
  displayName?: string,
): string {
  const title = envelope.content?.title
    ? inlinePlain(envelope.content.title).trim()
    : "";
  const name = nonempty(
    title,
    envelope.accessibility?.label ?? displayName ?? "",
  );
  return name.length > 0 ? `Explore ${name}` : "Explore";
}

function contractProvenance(
  type: BlockType,
  pins: readonly ContractDependency[],
): string | undefined {
  const pin = pins.find((entry) => entry.type === type);
  return pin ? `${pin.id} ${pin.digest}` : undefined;
}

function interactiveReference(
  renderer: IslandRendererReference,
): { module: string; exportName: string } | undefined {
  if (renderer.interactive)
    return {
      module: renderer.interactive.module,
      exportName: renderer.interactive.exportName ?? "default",
    };
  if (renderer.module)
    return {
      module: renderer.module,
      exportName: renderer.exportName ?? "default",
    };
  return undefined;
}

function interactiveNodes(
  block: Block<BlockType, unknown>,
  envelope: InteractiveEnvelope<JsonValue>,
  options: AdapterCompilerOptions,
  diagnostics: Diagnostic[],
  references: readonly ReferenceTarget[],
  displayName?: string,
  pins: readonly ContractDependency[] = [],
): RenderNode[] {
  const renderer = options.renderers?.[block.type];
  const interactive = renderer ? interactiveReference(renderer) : undefined;
  const staticRenderer = renderer?.static;
  const description = envelope.content?.description;
  const hasDescription = Array.isArray(description) && description.length > 0;
  const fallbackContent = envelope.fallback ?? envelope.content?.fallback;
  const hasFallback =
    Array.isArray(fallbackContent) && fallbackContent.length > 0;
  if (!staticRenderer && !hasFallback && !hasDescription) {
    diagnostics.push({
      level: "warning",
      code: "missing-static-representation",
      message: `Interactive block ${block.type} has no static representation.`,
      blockId: block.id,
    });
  }
  const explanation: RenderNode[] = [];
  if (envelope.content?.title?.length) {
    explanation.push(
      element(
        "p",
        { class: "publisle-interactive-title" },
        inline(
          envelope.content.title as Inline[],
          diagnostics,
          block,
          references,
        ),
      ),
    );
  }
  if (hasDescription)
    explanation.push(
      ...flow(description as unknown as Flow[], diagnostics, block, references),
    );
  if (envelope.content?.instructions?.length)
    explanation.push(
      ...flow(
        envelope.content.instructions as unknown as Flow[],
        diagnostics,
        block,
        references,
      ),
    );
  for (const key of ["purpose", "observations", "assumptions"] as const) {
    const content = envelope.content?.[key];
    if (content?.length)
      explanation.push(
        ...flow(content as Flow[], diagnostics, block, references),
      );
  }
  for (const preset of envelope.content?.presets ?? []) {
    if (preset.description?.length)
      explanation.push(
        ...flow(preset.description as Flow[], diagnostics, block, references),
      );
  }
  const visualization: RenderNode[] = staticRenderer
    ? [
        {
          kind: "component",
          module: staticRenderer.module,
          exportName: staticRenderer.exportName ?? "default",
          blockId: block.id,
          props: envelopeProps(envelope),
          artifact: staticRenderer.lower
            ? staticRenderer.lower(createIslandInput(block, envelope, pins))
            : hasFallback
              ? flow(
                  fallbackContent as unknown as Flow[],
                  diagnostics,
                  block,
                  references,
                )
              : [],
        },
      ]
    : hasFallback
      ? flow(
          fallbackContent as unknown as Flow[],
          diagnostics,
          block,
          references,
        )
      : [];
  const provenance = contractProvenance(block.type, pins);
  const region = (children: readonly RenderNode[]): RenderNode[] => [
    element(
      "section",
      {
        class: "publisle-interactive",
        ...(provenance ? { "data-publisle-contract": provenance } : {}),
      },
      children,
    ),
  ];
  if (!interactive) {
    diagnostics.push({
      level: "warning",
      code: "missing-island-renderer",
      message: `No island renderer is configured for ${block.type}.`,
      blockId: block.id,
    });
    return region([...explanation, ...visualization]);
  }
  const fallback = [...visualization];
  if (envelope.activation === "interaction") {
    fallback.push(
      element("button", { type: "button", "data-publisle-activate": "true" }, [
        text(exploreLabel(envelope, displayName)),
      ]),
    );
  }
  return region([
    ...explanation,
    {
      kind: "island",
      blockId: block.id,
      activation: envelope.activation,
      label: accessibleName(envelope, displayName),
      module: interactive.module,
      exportName: interactive.exportName,
      props: envelopeProps(envelope),
      fallback,
      ...(provenance ? { provenance } : {}),
    },
  ]);
}

function blockNodes(
  block: Block<BlockType, unknown>,
  options: AdapterCompilerOptions,
  diagnostics: Diagnostic[],
  references: readonly ReferenceTarget[],
  displayName?: string,
  pins: readonly ContractDependency[] = [],
): RenderNode[] {
  if (isInteractiveEnvelope(block.data))
    return interactiveNodes(
      block,
      block.data,
      options,
      diagnostics,
      references,
      displayName,
      pins,
    );
  const data = block.data as Record<string, unknown>;
  const reference = references.find((entry) => entry.blockId === block.id);
  switch (block.type) {
    case "publisle:paragraph":
      return [
        element(
          "p",
          {},
          inline(data["content"] as Inline[], diagnostics, block, references),
        ),
      ];
    case "publisle:heading":
      return [
        element(
          `h${Number(data["level"])}`,
          {
            "data-publisle-id": block.id,
            ...(typeof data["label"] === "string"
              ? { id: `reference-${data["label"]}` }
              : {}),
          },
          inline(data["content"] as Inline[], diagnostics, block, references),
        ),
      ];
    case "publisle:list":
      return flow([{ type: "list", ...data }], diagnostics, block, references);
    case "publisle:quote":
      return [
        element(
          "blockquote",
          {},
          flow(data["children"] as Flow[], diagnostics, block, references),
        ),
      ];
    case "publisle:code":
      return flow([{ type: "code", ...data }], diagnostics, block, references);
    case "publisle:math":
      return [
        element(
          data["display"] === true ? "div" : "span",
          {
            class:
              data["display"] === true && reference?.ordinal
                ? "publisle-math publisle-math-numbered"
                : "publisle-math",
            ...(typeof data["label"] === "string"
              ? { id: `reference-${data["label"]}` }
              : {}),
          },
          [
            ...renderMath(
              String(data["value"] ?? ""),
              data["display"] === true,
              diagnostics,
              block,
            ),
            ...(reference?.ordinal
              ? [
                  element("span", { class: "publisle-equation-number" }, [
                    text(`(${reference.ordinal})`),
                  ]),
                ]
              : []),
          ],
        ),
      ];
    case "publisle:divider":
      return [element("hr", {}, [])];
    case "publisle:figure": {
      const rawSrc = String(data["src"] ?? "").trim();
      const src = rawSrc ? safeUrl(rawSrc) : undefined;
      const original = data["original"] as Record<string, unknown> | undefined;
      const originalSrc =
        typeof original?.["src"] === "string"
          ? safeUrl(original["src"])
          : undefined;
      if (rawSrc && !src)
        diagnostics.push({
          level: "warning",
          code: "unsafe-url",
          message: "An unsafe figure URL was removed.",
          blockId: block.id,
        });
      // Alternative renditions keyed by variant name ("dark", …). The host's
      // CSS decides which variant its active theme consumes; hosts without a
      // mapping keep the base rendition.
      const variants = Object.entries(
        (data["variants"] ?? {}) as Record<string, unknown>,
      ).flatMap(([name, value]): [string, string][] => {
        if (typeof value !== "string") return [];
        const variantSrc = safeUrl(value);
        if (!variantSrc) {
          diagnostics.push({
            level: "warning",
            code: "unsafe-url",
            message: `An unsafe figure ${name} variant URL was removed.`,
            blockId: block.id,
          });
          return [];
        }
        return [[name, variantSrc]];
      });
      const themed = src !== undefined && variants.length > 0;
      return [
        element(
          "figure",
          {
            ...(typeof data["label"] === "string"
              ? { id: `reference-${data["label"]}` }
              : {}),
            ...(themed ? { class: "publisle-figure-themed" } : {}),
          },
          [
            ...(src
              ? [
                  element(
                    "img",
                    {
                      src,
                      alt: String(data["alt"] ?? "Figure description missing."),
                    },
                    [],
                  ),
                ]
              : [
                  element("p", { class: "publisle-figure-placeholder" }, [
                    text(
                      rawSrc
                        ? "An unsafe figure URL was removed."
                        : "Add an image URL",
                    ),
                  ]),
                ]),
            ...variants.map(([name, variantSrc]) =>
              // The base image carries the description; renditions are decorative.
              element(
                "img",
                {
                  src: variantSrc,
                  alt: "",
                  "data-publisle-variant": name,
                  "aria-hidden": "true",
                },
                [],
              ),
            ),
            ...(data["alt"] === undefined
              ? [
                  element("p", { class: "publisle-figure-missing-alt" }, [
                    text("Figure description missing."),
                  ]),
                ]
              : []),
            ...(reference || Array.isArray(data["caption"])
              ? [
                  element("figcaption", {}, [
                    ...(reference
                      ? [
                          element("span", { class: "publisle-figure-number" }, [
                            text(`${referenceText(reference)}. `),
                          ]),
                        ]
                      : []),
                    ...(Array.isArray(data["caption"])
                      ? flow(
                          data["caption"] as Flow[],
                          diagnostics,
                          block,
                          references,
                        )
                      : []),
                  ]),
                ]
              : []),
            ...(Array.isArray(data["credit"])
              ? [
                  element(
                    "small",
                    { class: "publisle-figure-credit" },
                    inline(
                      data["credit"] as Inline[],
                      diagnostics,
                      block,
                      references,
                    ),
                  ),
                ]
              : []),
            ...(originalSrc
              ? [
                  element(
                    "a",
                    {
                      class: "publisle-figure-original",
                      href: originalSrc,
                      download: String(original?.["filename"] ?? true),
                    },
                    [text("Download original")],
                  ),
                ]
              : []),
          ],
        ),
      ];
    }
    case "publisle:table": {
      const rows = data["rows"] as Inline[][][];
      const align = data["align"] as ("left" | "right" | "center" | null)[];
      return [
        element(
          "figure",
          typeof data["label"] === "string"
            ? { id: `reference-${data["label"]}` }
            : {},
          [
            ...(reference || Array.isArray(data["caption"])
              ? [
                  element("figcaption", {}, [
                    ...(reference
                      ? [
                          element("span", { class: "publisle-table-number" }, [
                            text(`${referenceText(reference)}. `),
                          ]),
                        ]
                      : []),
                    ...(Array.isArray(data["caption"])
                      ? flow(
                          data["caption"] as Flow[],
                          diagnostics,
                          block,
                          references,
                        )
                      : []),
                  ]),
                ]
              : []),
            element("table", {}, [
              element(
                "tbody",
                {},
                rows.map((row, rowIndex) =>
                  element(
                    "tr",
                    {},
                    row.map((cell, cellIndex) =>
                      element(
                        (typeof data["headerRows"] === "number"
                          ? data["headerRows"]
                          : 1) > rowIndex
                          ? "th"
                          : "td",
                        {
                          ...((typeof data["headerRows"] === "number"
                            ? data["headerRows"]
                            : 1) > rowIndex
                            ? { scope: "col" }
                            : {}),
                          ...(align[cellIndex]
                            ? { class: `publisle-align-${align[cellIndex]}` }
                            : {}),
                        },
                        inline(cell, diagnostics, block, references),
                      ),
                    ),
                  ),
                ),
              ),
            ]),
          ],
        ),
      ];
    }
    case "publisle:callout":
      return [
        element(
          "aside",
          {
            class: `publisle-callout publisle-callout-${String(data["variant"] ?? "note")}`,
          },
          [
            ...(typeof data["title"] === "string"
              ? [element("strong", {}, [text(data["title"])])]
              : []),
            ...flow(data["children"] as Flow[], diagnostics, block, references),
          ],
        ),
      ];
    case "publisle:footnote":
      return [
        element(
          "aside",
          { id: `footnote-${String(data["identifier"] ?? "")}` },
          flow(data["children"] as Flow[], diagnostics, block, references),
        ),
      ];
    case "publisle:embed": {
      const providerName = String(data["provider"] ?? "");
      const configuredProvider = options.embedProviders?.[providerName];
      const builtinProvider =
        builtinEmbedProviders[
          providerName as keyof typeof builtinEmbedProviders
        ];
      const provider =
        configuredProvider ??
        (builtinProvider
          ? (resourceId: string) => builtinProvider(resourceId)
          : undefined);
      const result = provider?.(String(data["resourceId"] ?? ""));
      const embedSrc = result ? safeEmbedUrl(result.src) : undefined;
      if (!result || !embedSrc) {
        diagnostics.push({
          level: "warning",
          code: "missing-embed-provider",
          message: `Embed provider ${providerName} is unavailable or rejected the resource ID.`,
          blockId: block.id,
        });
        return Array.isArray(data["fallback"])
          ? flow(data["fallback"] as Flow[], diagnostics, block, references)
          : [
              element(
                "p",
                { "data-publisle-embed-unavailable": providerName },
                [text(String(data["title"] ?? "Embedded content"))],
              ),
            ];
      }
      const ratio = data["aspectRatio"] as Record<string, unknown>;
      return [
        element("figure", { class: "publisle-embed" }, [
          element(
            "iframe",
            {
              src: embedSrc,
              title: String(data["title"] ?? ""),
              loading: "lazy",
              referrerpolicy: "strict-origin-when-cross-origin",
              allow: result.allow ?? "fullscreen",
              sandbox:
                ("sandbox" in result ? result.sandbox : undefined) ??
                "allow-scripts allow-same-origin allow-presentation",
              ...(result.allowFullscreen ? { allowfullscreen: true } : {}),
              style: `aspect-ratio:${Number(ratio["width"] ?? 16)}/${Number(ratio["height"] ?? 9)}`,
            },
            [],
          ),
          ...(Array.isArray(data["caption"])
            ? [
                element(
                  "figcaption",
                  {},
                  flow(
                    data["caption"] as Flow[],
                    diagnostics,
                    block,
                    references,
                  ),
                ),
              ]
            : []),
        ]),
      ];
    }
    case "publisle:diagram": {
      const engine = String(data["engine"] ?? "");
      const renderer = options.diagramRenderers?.[engine];
      if (!renderer) {
        diagnostics.push({
          level: "warning",
          code: "missing-diagram-renderer",
          message: `No renderer is registered for diagram engine ${engine}.`,
          blockId: block.id,
        });
        const print = data["printFallback"] as
          Record<string, unknown> | undefined;
        const printSrc =
          typeof print?.["src"] === "string"
            ? safeUrl(print["src"])
            : undefined;
        const fallback = printSrc
          ? [
              element(
                "img",
                { src: printSrc, alt: String(data["alt"] ?? "") },
                [],
              ),
            ]
          : Array.isArray(data["fallback"])
            ? flow(data["fallback"] as Flow[], diagnostics, block, references)
            : [element("pre", {}, [text(String(data["source"] ?? ""))])];
        return [
          element(
            "figure",
            typeof data["label"] === "string"
              ? { id: `reference-${data["label"]}` }
              : {},
            [
              ...fallback,
              ...(reference || Array.isArray(data["caption"])
                ? [
                    element("figcaption", {}, [
                      ...(reference
                        ? [
                            element(
                              "span",
                              { class: "publisle-diagram-number" },
                              [text(`${referenceText(reference)}. `)],
                            ),
                          ]
                        : []),
                      ...(Array.isArray(data["caption"])
                        ? flow(
                            data["caption"] as Flow[],
                            diagnostics,
                            block,
                            references,
                          )
                        : []),
                    ]),
                  ]
                : []),
            ],
          ),
        ];
      }
      let result;
      try {
        result = renderer({
          engine,
          source: String(data["source"] ?? ""),
          alt: String(data["alt"] ?? ""),
        });
      } catch (error) {
        diagnostics.push({
          level: "warning",
          code: "diagram-render-failed",
          message:
            error instanceof Error
              ? error.message
              : `Rendering ${engine} failed.`,
          blockId: block.id,
        });
        return Array.isArray(data["fallback"])
          ? flow(data["fallback"] as Flow[], diagnostics, block, references)
          : [element("pre", {}, [text(String(data["source"] ?? ""))])];
      }
      const rendered: RenderNode[] = [...result.static];
      if (result.interactive)
        rendered.push({
          kind: "island",
          blockId: block.id,
          implementation: result.interactive.implementation,
          activation: result.interactive.activation ?? "visible",
          label: result.accessibleText ?? String(data["alt"] ?? "Diagram"),
          module: result.interactive.module,
          exportName: result.interactive.exportName ?? "default",
          props: result.interactive.props ?? {},
          fallback: result.static,
        });
      return [
        element(
          "figure",
          typeof data["label"] === "string"
            ? { id: `reference-${data["label"]}` }
            : {},
          [
            element("div", { class: "publisle-diagram-screen" }, rendered),
            ...(result.print
              ? [
                  element(
                    "div",
                    { class: "publisle-diagram-print" },
                    result.print,
                  ),
                ]
              : []),
            ...(reference || Array.isArray(data["caption"])
              ? [
                  element("figcaption", {}, [
                    ...(reference
                      ? [
                          element(
                            "span",
                            { class: "publisle-diagram-number" },
                            [text(`${referenceText(reference)}. `)],
                          ),
                        ]
                      : []),
                    ...(Array.isArray(data["caption"])
                      ? flow(
                          data["caption"] as Flow[],
                          diagnostics,
                          block,
                          references,
                        )
                      : []),
                  ]),
                ]
              : []),
          ],
        ),
      ];
    }
    case "publisle:bibliography": {
      const entries = Array.isArray(data["entries"]) ? data["entries"] : [];
      if (options.bibliography)
        return [
          element(
            "section",
            { class: "publisle-bibliography" },
            options.bibliography.map((entry) =>
              element("p", { "data-publisle-bibliography-id": entry.id }, [
                text(entry.text),
              ]),
            ),
          ),
        ];
      return [
        element(
          "section",
          { class: "publisle-bibliography" },
          entries.flatMap((entry) => {
            if (
              typeof entry !== "object" ||
              entry === null ||
              Array.isArray(entry)
            )
              return [];
            const record = entry as Record<string, unknown>;
            const authors = Array.isArray(record["authors"])
              ? record["authors"].filter(
                  (author): author is string => typeof author === "string",
                )
              : [];
            const parts = [
              record["id"],
              ...authors,
              record["title"],
              record["raw"],
            ].filter((part): part is string => typeof part === "string");
            return [element("p", {}, [text(parts.join(" "))])];
          }),
        ),
      ];
    }
    case "publisle:raw-html":
      return options.rawHtml === "omit"
        ? []
        : options.rawHtml === "trusted" || typeof options.rawHtml === "function"
          ? [
              {
                kind: "raw",
                value:
                  typeof options.rawHtml === "function"
                    ? options.rawHtml(String(data["value"] ?? ""))
                    : String(data["value"] ?? ""),
              },
            ]
          : [
              element("pre", { "data-publisle-raw-html": true }, [
                text(String(data["value"] ?? "")),
              ]),
            ];
    default:
      diagnostics.push({
        level: "warning",
        code: "missing-renderer",
        message: `No renderer is available for ${block.type}.`,
        blockId: block.id,
      });
      if ("readableContent" in block && block.readableContent) {
        const content = block.readableContent as InteractiveContent;
        const prose = content.fallback?.length
          ? [content.fallback]
          : [
              content.title,
              content.description,
              content.purpose,
              content.instructions,
              content.observations,
              content.assumptions,
              ...(content.presets?.map((preset) => preset.description) ?? []),
            ];
        return [
          element("section", { "data-publisle-unknown-block": block.type }, [
            ...(block.readable?.provenance.kind === "generated"
              ? [
                  element("p", { "data-publisle-generated": true }, [
                    text(
                      `Generated by ${block.readable.provenance.generator} (${block.readable.provenance.version}); source: ${block.readable.provenance.source}.`,
                    ),
                  ]),
                ]
              : []),
            ...prose
              .filter((nodes) => nodes?.length)
              .map((nodes) => element("p", {}, [text(richText(nodes))])),
          ]),
        ];
      }
      return [
        element("div", { "data-publisle-unknown-block": block.type }, [
          text(`Unsupported block: ${block.type}`),
        ]),
      ];
  }
}

export function createRenderPlan(
  document: PreparedDocument,
  options: AdapterCompilerOptions = {},
): RenderPlan {
  const diagnostics: Diagnostic[] = [];
  const nodes = applyFootnoteNumbers(
    document.blocks.flatMap((block) =>
      blockNodes(
        block,
        options,
        diagnostics,
        document.references.targets,
        document.islands.find((island) => island.blockId === block.id)
          ?.displayName,
        document.dependencies ?? [],
      ),
    ),
    collectFootnoteNumbers(document.blocks),
  );
  const base = {
    document,
    nodes: wrapInputs(resolveCitations(nodes, options.citations), document),
    diagnostics: diagnostics.map((diagnostic) =>
      locateDiagnostic(diagnostic, document.sourceMap),
    ),
  };
  return document.metadata === undefined
    ? base
    : { ...base, metadata: document.metadata };
}

/** Footnote numbers by first-reference order, over the raw block payloads. */
function collectFootnoteNumbers(
  blocks: readonly { readonly data: unknown }[],
): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (
      node["type"] === "footnoteReference" &&
      typeof node["identifier"] === "string" &&
      !numbers.has(node["identifier"])
    )
      numbers.set(node["identifier"], numbers.size + 1);
    for (const child of Object.values(node)) visit(child);
  };
  for (const block of blocks) visit(block.data);
  return numbers;
}

/** Replace raw footnote labels with numbers on markers and definitions. */
function applyFootnoteNumbers(
  nodes: readonly RenderNode[],
  numbers: ReadonlyMap<string, number>,
): RenderNode[] {
  return nodes.map((node) => {
    if (node.kind !== "element") return node;
    const reference = node.tag === "sup" ? node : undefined;
    const anchor = reference?.children.find(
      (child): child is Extract<RenderNode, { kind: "element" }> =>
        child.kind === "element" &&
        child.tag === "a" &&
        typeof child.attributes["data-publisle-ref"] === "string" &&
        child.attributes["data-publisle-ref"].startsWith("footnote-"),
    );
    if (anchor) {
      const identifier = String(anchor.attributes["data-publisle-ref"]).slice(
        "footnote-".length,
      );
      const number = numbers.get(identifier);
      return number === undefined
        ? node
        : {
            ...node,
            children: node.children.map((child) =>
              child === anchor
                ? { ...anchor, children: [text(String(number))] }
                : child,
            ),
          };
    }
    if (node.tag === "aside" && typeof node.attributes["id"] === "string") {
      const number = numbers.get(
        node.attributes["id"].slice("footnote-".length),
      );
      if (number !== undefined)
        return {
          ...node,
          children: [
            element("span", { class: "publisle-footnote-number" }, [
              text(`${String(number)}. `),
            ]),
            ...node.children,
          ],
        };
    }
    return { ...node, children: applyFootnoteNumbers(node.children, numbers) };
  });
}

function resolveCitations(
  nodes: readonly RenderNode[],
  citations: AdapterCompilerOptions["citations"],
): RenderNode[] {
  if (!citations) return [...nodes];
  return nodes.map((node) => {
    if (node.kind === "island")
      return { ...node, fallback: resolveCitations(node.fallback, citations) };
    if (node.kind === "component" && node.artifact)
      return { ...node, artifact: resolveCitations(node.artifact, citations) };
    if (node.kind !== "element") return node;
    const raw = node.attributes["data-publisle-citation"];
    if (typeof raw === "string") {
      const key = citationKey({
        items: JSON.parse(raw) as Parameters<typeof citationKey>[0]["items"],
        prefix: String(node.attributes["data-publisle-citation-prefix"] ?? ""),
        suffix: String(node.attributes["data-publisle-citation-suffix"] ?? ""),
      });
      const value = citations[key];
      if (value !== undefined) return { ...node, children: [text(value)] };
    }
    return { ...node, children: resolveCitations(node.children, citations) };
  });
}

function wrapInputs(
  nodes: readonly RenderNode[],
  document: PreparedDocument,
): RenderNode[] {
  return nodes.map((node) => {
    if (node.kind === "element")
      return { ...node, children: wrapInputs(node.children, document) };
    if (node.kind !== "island" && !(node.kind === "component" && node.blockId))
      return node;
    const block = document.blocks.find((entry) => entry.id === node.blockId);
    if (!block)
      throw new Error("Island input requires a corresponding prepared block.");
    const activation = node.kind === "island" ? node.activation : "visible";
    const envelope = isInteractiveEnvelope(node.props)
      ? node.props
      : { activation, payload: node.props };
    return {
      ...node,
      ...(node.kind === "island"
        ? { fallback: wrapInputs(node.fallback, document) }
        : {}),
      props: createIslandInput(
        block,
        envelope,
        document.dependencies,
      ) as unknown as JsonValue,
    };
  });
}

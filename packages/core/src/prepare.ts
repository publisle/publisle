import { preparationPhase } from "./performance.ts";
import { sha256Hex } from "./hash.ts";
import { inspectProfiles } from "./profiles.ts";
import { migrateDocument } from "./document-migrations.ts";
import { stable } from "./identity.ts";
import { inspectReadable } from "./readable.ts";
import { createResourcePlanner, ResourcePlanningError } from "./resources.ts";

import {
  DOCUMENT_SCHEMA_VERSION,
  SchemaParseError,
  locateDiagnostic,
  type Block,
  type BlockType,
  type Diagnostic,
  type Document,
  type JsonValue,
  type PrepareResult,
  type PreparedBlock,
  type PreparedDocument,
  type ReferenceKind,
  type ReferenceTarget,
  traverseDeclared,
  validateSemantics,
  resolvePointer,
  TraversalError,
  EXPLANATION_TRAVERSAL,
  RICH_TRAVERSAL_RULES,
  richText,
  isPlainObject,
  parseContractDependencies,
  canonicalizeJson,
} from "@publisle/schema";

import type { AnyPortableBlockDefinition, PrepareOptions } from "./types.ts";

function mergeDefaults(defaults: unknown, data: unknown): unknown {
  if (
    defaults !== null &&
    data !== null &&
    typeof defaults === "object" &&
    typeof data === "object" &&
    !Array.isArray(defaults) &&
    !Array.isArray(data)
  ) {
    return { ...defaults, ...data };
  }
  return data;
}

function migrate(
  block: Block<BlockType, unknown>,
  definition: AnyPortableBlockDefinition,
): { data: unknown; version: number } {
  let data: unknown = block.data;
  let version = block.schemaVersion;
  const migrations = new Map(
    (definition.migrations ?? []).map((migration) => [
      migration.from,
      migration,
    ]),
  );
  while (version < definition.schemaVersion) {
    const migration = migrations.get(version);
    if (!migration)
      throw new SchemaParseError(
        "migration-failed",
        `No migration from schema version ${version}.`,
      );
    try {
      data = migration.migrate(structuredClone(data) as JsonValue);
    } catch (error) {
      throw new SchemaParseError(
        "migration-failed",
        `Block migration from schema version ${version} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    version += 1;
  }
  if (version > definition.schemaVersion) {
    const error = new Error(
      `Schema version ${version} is newer than supported version ${definition.schemaVersion}.`,
    );
    error.name = "UnsupportedBlockVersion";
    throw error;
  }
  return { data, version };
}

function referenceKind(type: string): ReferenceKind | undefined {
  if (type === "publisle:heading") return "heading";
  if (type === "publisle:figure") return "figure";
  if (type === "publisle:table") return "table";
  if (type === "publisle:math") return "equation";
  if (type === "publisle:diagram") return "diagram";
  return undefined;
}

export function prepare(
  document: Document<Block<BlockType, unknown>>,
  options: PrepareOptions,
): PrepareResult {
  const result = preparationPhase("prepare document", () =>
    prepareDocument(document, options),
  );
  const diagnostics = result.diagnostics.map((diagnostic) =>
    locateDiagnostic(diagnostic, options.sourceMap),
  );
  return {
    ...result,
    ...(result.document === undefined
      ? {}
      : {
          document: {
            ...result.document,
            diagnosticIdentity: preparationPhase("diagnostic identity", () =>
              sha256Hex(
                canonicalizeJson({
                  sourceMap: options.sourceMap ?? null,
                  diagnostics,
                }),
              ),
            ),
          },
        }),
    diagnostics,
  };
}

function prepareDocument(
  document: Document<Block<BlockType, unknown>>,
  options: PrepareOptions,
): PrepareResult {
  const diagnostics: Diagnostic[] = [];
  if (
    (options.preparationVersion !== undefined &&
      (typeof options.preparationVersion !== "string" ||
        !options.preparationVersion.trim())) ||
    (options.resourceResolver !== undefined &&
      (typeof options.resourceResolver.version !== "string" ||
        !options.resourceResolver.version.trim() ||
        typeof options.resourceResolver.resolve !== "function"))
  ) {
    return {
      diagnostics: [
        {
          level: "error",
          code: "invalid-preparation-options",
          message:
            "Preparation and resolver versions must be nonempty strings; a resolver must provide resolve().",
        },
      ],
    };
  }
  let sourceIdentity: string;
  try {
    sourceIdentity = preparationPhase("source validation and identity", () =>
      sha256Hex(
        preparationPhase("source canonicalization", () =>
          canonicalizeJson(document),
        ),
      ),
    );
    if (
      document.dependencies !== undefined &&
      document.schemaVersion !== DOCUMENT_SCHEMA_VERSION
    )
      throw new SchemaParseError(
        "locked-source-conversion-required",
        "Locked document envelope requires explicit conversion, never render-time migration.",
      );
    document = preparationPhase("document migrations", () =>
      migrateDocument(
        document,
        options.documentMigrations ?? [],
        DOCUMENT_SCHEMA_VERSION,
      ),
    );
  } catch (error) {
    diagnostics.push({
      level: "error",
      code:
        error instanceof SchemaParseError
          ? error.code
          : "document-migration-failed",
      message:
        error instanceof Error ? error.message : "Document migration failed.",
    });
    return { diagnostics };
  }
  const ids = new Set<string>();
  if (document.dependencies !== undefined) {
    try {
      const pins = parseContractDependencies(document.dependencies);
      const approved = parseContractDependencies(options.contractPins ?? []);
      const used = new Set(
        document.blocks.map(
          (block) => `${block.type}@${String(block.schemaVersion)}`,
        ),
      );
      if (
        pins.length !== used.size ||
        pins.some(
          (pin) => !used.has(`${pin.type}@${String(pin.schemaVersion)}`),
        )
      )
        throw new SchemaParseError(
          "contract-manifest-mismatch",
          "Manifest must contain exactly one pin for every used type/payload version.",
        );
      for (const pin of pins) {
        if (
          !approved.some(
            (entry) =>
              entry.type === pin.type &&
              entry.schemaVersion === pin.schemaVersion &&
              entry.id === pin.id &&
              entry.digest === pin.digest,
          )
        )
          throw new SchemaParseError(
            "missing-contract-pin",
            `No approved matching immutable contract for ${pin.type}. Resolve/verify its bundle at preparation time.`,
          );
        const definition = options.registry.get(pin.type);
        if (definition && definition.schemaVersion !== pin.schemaVersion)
          throw new SchemaParseError(
            "locked-version-conversion-required",
            "A locked source version cannot be implicitly migrated. Preserve source and explicitly convert before pinning the new contract.",
          );
      }
    } catch (error) {
      return {
        diagnostics: [
          {
            level: "error",
            code:
              error instanceof SchemaParseError
                ? error.code
                : "invalid-contract-manifest",
            message:
              error instanceof Error
                ? error.message
                : "Invalid contract manifest.",
          },
        ],
      };
    }
  }
  const blocks: PreparedBlock[] = [];
  const resourcePlanner = createResourcePlanner(options.resourceResolver);
  const islands: PreparedDocument["islands"][number][] = [];
  const targets: ReferenceTarget[] = [];
  const targetLabels = new Set<string>();
  const pendingReferences: {
    label: string;
    blockId: Block["id"];
    level: "warning" | "error";
    pointer: string;
  }[] = [];
  const ordinals = new Map<ReferenceKind, number>();
  const traversal: NonNullable<PreparedDocument["traversal"]>[number][] = [];
  const visited = new Set<string>();
  const collectVisits = (
    block: Block<BlockType, unknown>,
    visits: readonly import("@publisle/schema").TraversalVisit[],
    referenceLevel: "warning" | "error" = "error",
  ): void => {
    for (const visit of visits) {
      const key = `${block.id}:${visit.kind}:${visit.pointer}`;
      if (visited.has(key)) continue;
      visited.add(key);
      traversal.push({ ...visit, blockId: block.id });
      if (visit.kind === "unresolved") {
        diagnostics.push({
          level: "warning",
          code: "unresolved-traversal-branch",
          message: `Preserved unrecognized content branch ${visit.type ?? ""} without interpreting it.`,
          pointer: visit.pointer,
          blockId: block.id,
        });
        continue;
      }
      if (visit.kind === "resource") {
        // An empty figure source is an authoring placeholder, not a resource.
        if (typeof visit.value === "string" && visit.value.trim() === "")
          continue;
        resourcePlanner.add(
          typeof visit.value === "string" ? { uri: visit.value } : visit.value,
        );
        continue;
      }
      const data = isPlainObject(visit.value) ? visit.value : {};
      if (
        visit.kind === "reference" &&
        visit.type === "preset" &&
        data["binding"] !== undefined
      ) {
        let resolved = false;
        try {
          resolved =
            typeof data["binding"] === "string" &&
            resolvePointer(block.data, data["binding"]).found;
        } catch {
          /* Invalid fixed pointer, not executable behavior. */
        }
        if (!resolved)
          diagnostics.push({
            level: referenceLevel,
            code: "unresolved-preset-binding",
            message: `Preset ${typeof data["id"] === "string" ? data["id"] : ""} binding does not exist or is not a fixed pointer.`,
            blockId: block.id,
            pointer: `${visit.pointer}/binding`,
          });
      }
      if (
        visit.kind === "reference" &&
        visit.type === "crossReference" &&
        typeof data["target"] === "string"
      )
        pendingReferences.push({
          label: data["target"],
          blockId: block.id,
          level: referenceLevel,
          pointer: visit.pointer,
        });
      const kind =
        visit.kind === "node" && visit.type
          ? referenceKind(`publisle:${visit.type}`)
          : undefined;
      if (kind && typeof data["label"] === "string") {
        const label = data["label"];
        if (targetLabels.has(label))
          diagnostics.push({
            level: "error",
            code: "duplicate-reference-label",
            message: `Duplicate reference label ${label}.`,
            blockId: block.id,
            pointer: visit.pointer,
          });
        else {
          targetLabels.add(label);
          const ordinal =
            kind === "heading" ? undefined : (ordinals.get(kind) ?? 0) + 1;
          if (ordinal !== undefined) ordinals.set(kind, ordinal);
          targets.push({
            label,
            blockId: block.id,
            kind,
            ...(visit.pointer ? { pointer: visit.pointer } : {}),
            ...(ordinal === undefined ? {} : { ordinal }),
            ...(kind === "heading" ? { title: richText(data["content"]) } : {}),
          });
        }
      }
    }
  };

  const collect: typeof collectVisits = (...args) =>
    preparationPhase("reference/resource collection", () =>
      collectVisits(...args),
    );
  const traverse: typeof traverseDeclared = (...args) =>
    preparationPhase("declared traversal", () => traverseDeclared(...args));

  for (const block of document.blocks) {
    if (ids.has(block.id)) {
      diagnostics.push({
        level: "error",
        code: "duplicate-block-id",
        message: `Duplicate block id ${block.id}.`,
        blockId: block.id,
      });
      continue;
    }
    ids.add(block.id);
    const definition = options.registry.get(block.type);
    let readableContent:
      import("@publisle/schema").InteractiveContent | undefined;
    try {
      const content = preparationPhase("readable inspection", () =>
        inspectReadable(block),
      );
      readableContent = content;
      if (content && !definition)
        collect(
          block,
          traverse(content, {
            root: EXPLANATION_TRAVERSAL,
            rules: RICH_TRAVERSAL_RULES,
          }).map((visit) => ({
            ...visit,
            pointer: `${block.readable?.binding ?? "/readable/content"}${visit.pointer}`,
          })),
          definition ? "error" : "warning",
        );
    } catch (error) {
      diagnostics.push({
        level: "warning",
        code:
          error instanceof SchemaParseError
            ? error.code
            : error instanceof ResourcePlanningError
              ? error.code
              : "invalid-readable-representation",
        message:
          error instanceof Error
            ? error.message
            : "Invalid readable representation.",
        blockId: block.id,
      });
    }
    if (!definition) {
      diagnostics.push({
        level: options.unknownBlocks === "error" ? "error" : "warning",
        code: "unknown-block-type",
        message: `No block definition is registered for ${block.type}.`,
        blockId: block.id,
      });
      if (options.unknownBlocks !== "error")
        blocks.push({
          ...block,
          data: preparationPhase("unknown payload cloning", () =>
            structuredClone(block.data),
          ),
          ...(readableContent
            ? {
                readableContent: preparationPhase("readable cloning", () =>
                  structuredClone(readableContent),
                ),
              }
            : {}),
          prepared: true,
        });
      continue;
    }

    try {
      const migrated = preparationPhase("block migrations", () =>
        migrate(block, definition),
      );
      const input = preparationPhase("payload cloning and defaults", () =>
        mergeDefaults(definition.defaults, structuredClone(migrated.data)),
      );
      const parsed = preparationPhase("payload parsing", () =>
        definition.schema.parse(input),
      );
      const data = preparationPhase("normalization", () =>
        definition.normalize ? definition.normalize(parsed) : parsed,
      );
      if (
        document.dependencies !== undefined &&
        canonicalizeJson(data) !== canonicalizeJson(block.data)
      )
        throw new SchemaParseError(
          "locked-source-conversion-required",
          "Locked source cannot be implicitly normalized. Preserve it and explicitly approve conversion before pinning.",
        );
      const prepared = {
        ...block,
        schemaVersion: definition.schemaVersion,
        data,
        ...(readableContent
          ? {
              readableContent: preparationPhase("readable cloning", () =>
                structuredClone(readableContent),
              ),
            }
          : {}),
        prepared: true,
      } as PreparedBlock;
      blocks.push(prepared);
      if (definition.semantics)
        diagnostics.push(
          ...preparationPhase("semantic validation", () =>
            validateSemantics(definition.semantics, data),
          ).map((diagnostic) => ({
            ...diagnostic,
            level: "error" as const,
            blockId: block.id,
          })),
        );
      if (definition.traversal)
        preparationPhase("traversal and reference/resource collection", () =>
          collect(prepared, traverse(data, definition.traversal!)),
        );
      if (readableContent)
        collect(
          prepared,
          traverse(readableContent, {
            root: EXPLANATION_TRAVERSAL,
            rules: RICH_TRAVERSAL_RULES,
          }).map((visit) => ({
            ...visit,
            pointer: `${block.readable?.binding ?? "/readable/content"}${visit.pointer}`,
          })),
        );
      let declaredResources: unknown;
      try {
        declaredResources = definition.resources
          ? preparationPhase("resource declarations", () =>
              definition.resources!(data),
            )
          : [];
      } catch (error) {
        throw new ResourcePlanningError(
          "resource-analysis-failed",
          `Resource declarations for ${block.type} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!Array.isArray(declaredResources))
        throw new ResourcePlanningError(
          "invalid-resource",
          `Resource declarations for ${block.type} must be an array.`,
        );
      for (const resource of declaredResources as readonly unknown[]) {
        resourcePlanner.add(resource);
      }
      const island = preparationPhase("island planning", () =>
        definition.island?.(data),
      );
      if (island)
        islands.push({
          blockId: block.id,
          blockType: block.type,
          activation: island.activation,
          ...(island.displayName === undefined
            ? {}
            : { displayName: island.displayName }),
        });
    } catch (error) {
      diagnostics.push({
        level: "error",
        code:
          error instanceof ResourcePlanningError
            ? error.code
            : error instanceof TraversalError
              ? "invalid-traversal"
              : error instanceof SchemaParseError
                ? error.code
                : error instanceof Error &&
                    error.name === "UnsupportedBlockVersion"
                  ? "unsupported-block-version"
                  : "invalid-block-data",
        message:
          error instanceof Error
            ? error.message
            : `Could not prepare ${block.type}.`,
        blockId: block.id,
      });
    }
  }

  preparationPhase("reference resolution", () => {
    for (const reference of pendingReferences) {
      if (!targetLabels.has(reference.label))
        diagnostics.push({
          level: reference.level,
          code: "unresolved-cross-reference",
          message: `Cross-reference target ${reference.label} does not exist.`,
          blockId: reference.blockId,
          pointer: reference.pointer,
        });
    }
  });
  if (diagnostics.some(({ level }) => level === "error"))
    return { diagnostics };
  if (options.profiles?.length || options.diagnosticPolicy) {
    const semanticDocument: Document<Block<BlockType, unknown>> = {
      schemaVersion: document.schemaVersion,
      blocks: blocks.map(({ id, type, schemaVersion, data }) => ({
        id,
        type,
        schemaVersion,
        data,
      })),
      ...(document.metadata === undefined
        ? {}
        : { metadata: document.metadata }),
    };
    diagnostics.push(
      ...preparationPhase("profiles", () =>
        inspectProfiles(semanticDocument, options, traversal),
      ),
    );
  }
  if (diagnostics.some(({ level }) => level === "error"))
    return { diagnostics };
  const resources = preparationPhase("resource plan finalization", () =>
    resourcePlanner.plan(),
  );
  const preparationIdentity = {
    // Bump when built-in preparation semantics or plan format changes.
    coreVersion: "2",
    hostVersion: options.preparationVersion ?? "1",
    unknownBlocks: options.unknownBlocks ?? "preserve",
    profiles:
      options.profiles?.map(({ name, version }) => ({
        name,
        version: version ?? "1",
      })) ?? [],
    diagnosticPolicy: options.diagnosticPolicy ?? {},
    resolverVersion: options.resourceResolver?.version ?? null,
    resolverBase: options.resourceResolver?.base ?? null,
    resources,
  };
  const base = {
    ...(document.dependencies === undefined
      ? {}
      : { dependencies: document.dependencies }),
    ...(document.extensions === undefined
      ? {}
      : { extensions: document.extensions }),
    sourceIdentity,
    ...(options.sourceMap === undefined
      ? {}
      : { sourceMap: options.sourceMap }),
    kind: "publisle:prepared-document" as const,
    schemaVersion: document.schemaVersion,
    blocks,
    traversal,
    resources,
    references: { targets },
    islands,
    cacheIdentity: preparationPhase("prepared identity", () =>
      sha256Hex(
        preparationPhase("prepared canonical serialization", () =>
          stable({
            document: {
              schemaVersion: document.schemaVersion,
              metadata: document.metadata ?? null,
              blocks,
              dependencies: document.dependencies ?? null,
              extensions: document.extensions ?? null,
            },
            registry: options.registry.version,
            preparation: preparationIdentity,
          }),
        ),
      ),
    ),
  };
  const prepared: PreparedDocument =
    document.metadata === undefined
      ? base
      : { ...base, metadata: document.metadata };
  return {
    document: { ...prepared, semanticIdentity: prepared.cacheIdentity },
    diagnostics,
  };
}

export function assertPrepared(result: PrepareResult): PreparedDocument {
  if (!result.document) {
    throw new Error(
      result.diagnostics.map(({ message }) => message).join("\n") ||
        "Document preparation failed.",
    );
  }
  return result.document;
}

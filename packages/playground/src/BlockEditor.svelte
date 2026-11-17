<script lang="ts">
  import type { Block, BlockId } from "@publisle/schema";
  import JsonField from "./JsonField.svelte";
  import {
    appendSegment,
    blockFields,
    blockLabels,
    fieldValue,
    flowText,
    inlineSegments,
    insertListItem,
    listItemEdits,
    listText,
    removeListItem,
    removeSegment,
    SEGMENT_KINDS,
    setFieldJson,
    setFieldValue,
    setFlowText,
    setListText,
    setSegmentText,
    setSegmentUrl,
    setTableText,
    updateListItemChecked,
    updateListItemText,
    tableText,
    type FieldSpec,
    type PlaygroundExtensions,
  } from "./index.ts";

  interface Props {
    block: Block;
    onRemove: (id: BlockId) => void;
    onMove: (id: BlockId, direction: "up" | "down") => void;
    onUpdate: (id: BlockId, data: unknown) => void;
    onDuplicate?: (id: BlockId) => void;
    onSelect?: (id: BlockId) => void;
    selected?: boolean;
    extensions?: PlaygroundExtensions;
  }

  let {
    block,
    onRemove,
    onMove,
    onUpdate,
    onDuplicate,
    onSelect,
    selected = false,
    extensions,
  }: Props = $props();

  let addKind = $state("text");
  let expandedMath = $state<number | null>(null);
  let MathEditor = $state<
    typeof import("./MathEditor.svelte").default | undefined
  >(undefined);
  $effect(() => {
    if (expandedMath === null || MathEditor) return;
    let active = true;
    void import("./MathEditor.svelte").then((module) => {
      if (active) MathEditor = module.default;
    });
    return () => {
      active = false;
    };
  });

  const label = $derived(blockLabels(extensions)[block.type] ?? block.type);
  const data = $derived(
    typeof block.data === "object" && block.data !== null
      ? (block.data as Record<string, unknown>)
      : {},
  );
  const specs = $derived(blockFields(block.type, extensions));

  // Per-kind tint classes for inline segment chips (editor-only decoration).
  const SEGMENT_TINTS: Record<string, string> = {
    inlineMath: "segment--math",
    inlineCode: "segment--code",
    citation: "segment--citation",
    crossReference: "segment--xref",
    footnote: "segment--footnote",
  };

  function segmentTint(kind: string): string {
    return SEGMENT_TINTS[kind] ?? "";
  }

  function plainValue(spec: FieldSpec): string {
    const value = fieldValue(data, spec);
    return typeof value === "string" ? value : String(value);
  }

  function selectOptions(spec: FieldSpec): readonly {
    readonly value: string;
    readonly label: string;
  }[] {
    const options = spec.options ?? [];
    const current = plainValue(spec);
    if (current && !options.some((option) => option.value === current))
      return [{ value: current, label: current }, ...options];
    return options;
  }

  function applyPlain(spec: FieldSpec, value: string): void {
    onUpdate(block.id, setFieldValue(data, spec, value));
  }

  function applyFlow(spec: FieldSpec, value: string): unknown {
    const previous = data[spec.key];
    if (spec.kind === "flow") {
      if (flowText(previous as never) === value) return previous;
      return setFlowText(value);
    }
    if (spec.key === "rows") {
      if (tableText(previous as never) === value) return previous;
      return setTableText(value);
    }
    return setListText(value);
  }

  function flowValue(spec: FieldSpec): string {
    if (spec.kind === "flow") return flowText(data[spec.key] as never);
    if (spec.key === "rows") return tableText(data[spec.key] as never);
    return listText(data[spec.key]);
  }

  function setSegment(
    key: string,
    nodes: readonly unknown[],
    index: number,
    value: string,
  ): void {
    onUpdate(block.id, {
      ...data,
      [key]: setSegmentText(nodes, index, value),
    });
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<section
  class="block-editor"
  class:selected
  data-block-type={block.type}
  onclick={() => onSelect?.(block.id)}
>
  <header class="block-editor__header">
    <strong>{label}</strong>
    <div class="block-editor__actions">
      <button type="button" onclick={() => onMove(block.id, "up")} aria-label="Move block up"><span aria-hidden="true">↑</span> Up</button>
      <button type="button" onclick={() => onMove(block.id, "down")} aria-label="Move block down"><span aria-hidden="true">↓</span> Down</button>
      {#if onDuplicate}
        <button type="button" onclick={() => onDuplicate(block.id)} aria-label="Duplicate block">Copy</button>
      {/if}
      <button type="button" onclick={() => onRemove(block.id)} aria-label="Remove block">Remove</button>
    </div>
  </header>
  <div class="block-editor__body">
    {#if specs.length === 0}
      <p class="muted">Nothing to configure.</p>
    {:else}
      {#each specs as spec (spec.key + spec.kind)}
        {#if spec.kind === "segments"}
          <fieldset class="field field--segments">
            <legend>{spec.label}</legend>
            {#each inlineSegments(data[spec.key] as readonly unknown[]) as segment (segment.index)}
              <div class="segment" data-segment-kind={segment.kind}>
                <button
                  type="button"
                  class="segment__chip {segmentTint(segment.kind)}"
                  title={segment.kind === "inlineMath"
                    ? "Toggle math editor"
                    : segment.kind}
                  aria-expanded={segment.kind === "inlineMath"
                    ? expandedMath === segment.index
                    : undefined}
                  onclick={() => {
                    if (segment.kind === "inlineMath")
                      expandedMath =
                        expandedMath === segment.index
                          ? null
                          : segment.index;
                  }}
                >
                  {segment.kind === "inlineMath" && expandedMath !== segment.index ? "∑ " : ""}{segment.label}
                </button>
                {#if segment.kind === "inlineMath" && expandedMath === segment.index}
                  <div class="segment__editor">
                    {#if MathEditor}
                    <MathEditor
                      compact
                      collapsible
                      value={segment.value}
                      ariaLabel="Inline math for {segment.label}"
                      onchange={(value) =>
                        setSegment(
                          spec.key,
                          data[spec.key] as readonly unknown[],
                          segment.index,
                          value,
                        )}
                    />
                    {:else}
                      <p>Loading math editor…</p>
                    {/if}
                  </div>
                {:else}
                  <textarea
                    rows={segment.kind === "text" ? 3 : 2}
                    aria-label={`${spec.label}: ${segment.label} ${segment.index + 1}`}
                    value={segment.value}
                    placeholder={segment.kind === "inlineImage" ? "Alt text" : segment.placeholder ?? ""}
                    class={segmentTint(segment.kind)}
                    oninput={(event) =>
                      onUpdate(block.id, {
                        ...data,
                        [spec.key]: setSegmentText(
                          data[spec.key] as readonly unknown[],
                          segment.index,
                          event.currentTarget.value,
                        ),
                      })}
                  ></textarea>
                  {#if segment.url !== undefined}
                    <input
                      type="url"
                      aria-label={`${segment.label} URL ${segment.index + 1}`}
                      value={segment.url}
                      placeholder="https://"
                      oninput={(event) =>
                        onUpdate(block.id, {
                          ...data,
                          [spec.key]: setSegmentUrl(
                            data[spec.key] as readonly unknown[],
                            segment.index,
                            event.currentTarget.value,
                          ),
                        })}
                    />
                    {#if segment.kind === "inlineImage" && segment.url}
                      <img
                        src={segment.url}
                        alt=""
                        class="mt-1 max-h-16 rounded border border-line"
                      />
                    {/if}
                  {/if}
                {/if}
                <button
                  type="button"
                  aria-label="Remove {segment.label}"
                  onclick={() =>
                    onUpdate(block.id, {
                      ...data,
                      [spec.key]: removeSegment(
                        data[spec.key] as readonly unknown[],
                        segment.index,
                      ),
                    })}
                >✕</button>
              </div>
            {/each}
            <div class="segment segment--add">
              {#snippet addRow()}
                <select
                  aria-label="Inline content kind"
                  bind:value={addKind}
                >
                  {#each SEGMENT_KINDS as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
                <button
                  type="button"
                  onclick={() =>
                    onUpdate(block.id, {
                      ...data,
                      [spec.key]: appendSegment(
                        data[spec.key] as readonly unknown[],
                        addKind,
                      ),
                    })}
                >Add</button>
              {/snippet}
              {@render addRow()}
            </div>
          </fieldset>
        {:else if spec.kind === "json"}
          <details class="field field--json">
            <summary>{spec.label}</summary>
            <JsonField
              storageKey={block.id + spec.key}
              value={data[spec.key]}
              label={spec.label}
              onApply={(parsed) =>
                onUpdate(block.id, setFieldJson(data, spec, parsed))}
            />
          </details>
        {:else if spec.kind === "checkbox"}
          <label class="field field--check">
            <input
              type="checkbox"
              checked={fieldValue(data, spec) === true}
              onchange={(event) =>
                onUpdate(
                  block.id,
                  setFieldValue(data, spec, event.currentTarget.checked),
                )}
            />
            {spec.label}
          </label>
        {:else if spec.kind === "select"}
          <label class="field field--short">
            {spec.label}
            <select
              value={plainValue(spec)}
              oninput={(event) => applyPlain(spec, event.currentTarget.value)}
            >
              {#each selectOptions(spec) as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>
        {:else if spec.kind === "list"}
          {@const rows = listItemEdits(data[spec.key])}
          <fieldset class="field">
            <legend>{spec.label}</legend>
            {#each rows as row (row.index)}
              <div class="flex items-center gap-2">
                <input
                  type="checkbox"
                  aria-label="Task {row.index + 1}"
                  checked={row.checked === true}
                  onchange={(event) =>
                    onUpdate(block.id, {
                      ...data,
                      [spec.key]: updateListItemChecked(
                        data[spec.key],
                        row.index,
                        event.currentTarget.checked,
                      ),
                    })}
                />
                <input
                  class="min-w-0 flex-1"
                  aria-label="Item {row.index + 1}"
                  value={row.text}
                  oninput={(event) =>
                    onUpdate(block.id, {
                      ...data,
                      [spec.key]: updateListItemText(
                        data[spec.key],
                        row.index,
                        event.currentTarget.value,
                      ),
                    })}
                  onkeydown={(event) => {
                    if (event.key !== "Enter" || row.index !== rows.length - 1)
                      return;
                    event.preventDefault();
                    onUpdate(block.id, {
                      ...data,
                      [spec.key]: insertListItem(data[spec.key], row.index),
                    });
                  }}
                />
                <button
                  type="button"
                  aria-label="Remove item {row.index + 1}"
                  onclick={() =>
                    onUpdate(block.id, {
                      ...data,
                      [spec.key]: removeListItem(data[spec.key], row.index),
                    })}
                >Remove</button>
              </div>
            {/each}
            <button
              type="button"
              onclick={() =>
                onUpdate(block.id, {
                  ...data,
                  [spec.key]: insertListItem(
                    data[spec.key],
                    Math.max(0, rows.length - 1),
                  ),
                })}
            >Add item</button>
          </fieldset>
        {:else if spec.kind === "flow" || spec.kind === "rows"}
          <label class="field">
            {spec.label}
            <textarea
              rows={spec.rows ?? 3}
              value={flowValue(spec)}
              oninput={(event) =>
                onUpdate(block.id, {
                  ...data,
                  [spec.key]: applyFlow(spec, event.currentTarget.value),
                })}
            ></textarea>
            {#if spec.hint}<small class="muted">{spec.hint}</small>{/if}
          </label>
        {:else if spec.kind === "textarea"}
          <label class="field">
            {spec.label}
            <textarea
              rows={spec.rows ?? 3}
              value={plainValue(spec)}
              oninput={(event) => applyPlain(spec, event.currentTarget.value)}
            ></textarea>
            {#if spec.hint}<small class="muted">{spec.hint}</small>{/if}
          </label>
        {:else}
          <label class="field field--short">
            {spec.label}
            <input
              type={spec.kind === "number" ? "number" : "text"}
              value={plainValue(spec)}
              placeholder={spec.placeholder ?? ""}
              oninput={(event) => applyPlain(spec, event.currentTarget.value)}
            />
            {#if spec.key === "src" && plainValue(spec)}
              <img
                src={plainValue(spec)}
                alt=""
                class="mt-2 max-h-24 rounded border border-line"
              />
            {/if}
            {#if spec.hint}<small class="muted">{spec.hint}</small>{/if}
          </label>
        {/if}
      {/each}
    {/if}
    <details class="payload-json">
      <summary>Payload JSON</summary>
      <JsonField
        storageKey={block.id}
        value={data}
        label="Full block data"
        onApply={(parsed) => onUpdate(block.id, parsed)}
      />
    </details>
  </div>
</section>

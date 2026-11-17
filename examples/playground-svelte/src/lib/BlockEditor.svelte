<script lang="ts">
  import type { Block, BlockId } from "@publisle/schema";
  import type { BlockType, FieldSpec } from "@publisle/playground-core";
  import JsonField from "./JsonField.svelte";
  import {
    BLOCK_LABELS,
    SEGMENT_KINDS,
    appendSegment,
    blockFields,
    fieldValue,
    flowText,
    inlineSegments,
    insertListItem,
    listItemEdits,
    listText,
    removeListItem,
    removeSegment,
    setFieldJson,
    setFieldValue,
    setFlowText,
    setListText,
    setSegmentText,
    setSegmentUrl,
    updateListItemChecked,
    updateListItemText,
    setTableText,
    tableText,
  } from "@publisle/playground-core";

  interface Props {
    block: Block;
    onRemove: (id: BlockId) => void;
    onMove: (id: BlockId, direction: "up" | "down") => void;
    onUpdate: (id: BlockId, data: unknown) => void;
  }

  let { block, onRemove, onMove, onUpdate }: Props = $props();

  let addKind = $state("text");

  const label = $derived(BLOCK_LABELS[block.type as BlockType] ?? block.type);
  const data = $derived(
    typeof block.data === "object" && block.data !== null
      ? (block.data as Record<string, unknown>)
      : {},
  );
  const specs = $derived(blockFields(block.type as BlockType));

  function plainValue(spec: FieldSpec): string {
    const value = fieldValue(data, spec);
    return typeof value === "string" ? value : String(value);
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
</script>

<section class="block-editor" data-block-type={block.type}>
  <header class="block-editor__header">
    <strong>{label}</strong>
    <div class="block-editor__actions">
      <button type="button" onclick={() => onMove(block.id, "up")} aria-label="Move block up">Up</button>
      <button type="button" onclick={() => onMove(block.id, "down")} aria-label="Move block down">Down</button>
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
              <div class="segment">
                <span class="segment__label">{segment.label}</span>
                <input
                  type="text"
                  value={segment.value}
                  placeholder={segment.placeholder ?? ""}
                  onchange={(event) =>
                    onUpdate(block.id, {
                      ...data,
                      [spec.key]: setSegmentText(
                        data[spec.key] as readonly unknown[],
                        segment.index,
                        event.currentTarget.value,
                      ),
                    })}
                />
                {#if segment.url !== undefined}
                  <input
                    type="url"
                    aria-label="{segment.label} URL"
                    value={segment.url}
                    placeholder="https://"
                    onchange={(event) =>
                      onUpdate(block.id, {
                        ...data,
                        [spec.key]: setSegmentUrl(
                          data[spec.key] as readonly unknown[],
                          segment.index,
                          event.currentTarget.value,
                        ),
                      })}
                  />
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
          <label class="field">
            {spec.label}
            <select
              value={plainValue(spec)}
              onchange={(event) => applyPlain(spec, event.currentTarget.value)}
            >
              {#each spec.options ?? [] as option (option.value)}
                <option value={option.value}>{option.label}</option>
              {/each}
            </select>
          </label>
        {:else if spec.kind === "list"}
          {@const rows = listItemEdits(data[spec.key])}
          <fieldset class="field">
            <legend>{spec.label}</legend>
            {#each rows as row (row.index)}
              <div class="segment">
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
                  aria-label="Item {row.index + 1}"
                  value={row.text}
                  onchange={(event) =>
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
              onchange={(event) =>
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
              onchange={(event) => applyPlain(spec, event.currentTarget.value)}
            ></textarea>
            {#if spec.hint}<small class="muted">{spec.hint}</small>{/if}
          </label>
        {:else}
          <label class="field">
            {spec.label}
            <input
              type={spec.kind === "number" ? "number" : "text"}
              value={plainValue(spec)}
              placeholder={spec.placeholder ?? ""}
              onchange={(event) => applyPlain(spec, event.currentTarget.value)}
            />
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

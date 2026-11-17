<script lang="ts">
  // Full-width shelf of the common blocks. One tap inserts; each choice
  // carries a static miniature of the compiled block. It sits above the
  // editor, so the document itself is not squeezed under a sticky strip.
  import BlockSample from "./BlockSample.svelte";

  interface Item {
    readonly type: string;
    readonly label: string;
  }

  interface Props {
    items: readonly Item[];
    empty: boolean;
    onInsert: (type: string) => void;
    onMore: () => void;
  }

  let { items, empty, onInsert, onMore }: Props = $props();
</script>

<div role="group" aria-label="Add a block" class="flex flex-col gap-3">
  <p class="text-sm font-medium text-muted">
    {empty ? "Add a block to start" : "Add a block"}
  </p>
  <div class="flex snap-x gap-3 overflow-x-auto pb-1">
    {#each items as item (item.type)}
      <div
        class="group relative flex min-h-28 w-36 shrink-0 snap-start flex-col gap-2 rounded-xl border border-line bg-bg p-2.5 transition-colors hover:border-accent has-[:focus-visible]:border-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/50"
      >
        <div class="inserter-sample h-16 overflow-hidden rounded-lg bg-surface px-2 py-1.5">
          <BlockSample type={item.type} label={item.label} />
        </div>
        <span class="truncate text-center text-sm font-medium" aria-hidden="true">{item.label}</span>
        <button
          type="button"
          class="absolute inset-0 rounded-xl focus:outline-none"
          aria-label="Add {item.label.toLowerCase()}"
          onclick={() => onInsert(item.type)}
        ></button>
      </div>
    {/each}
    <button
      type="button"
      class="flex min-h-28 w-36 shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line px-3 text-sm font-medium text-muted transition-colors hover:border-accent hover:text-accent"
      title="More blocks (Ctrl+K)"
      onclick={onMore}
    >
      <span aria-hidden="true" class="text-xl leading-none">⋯</span>
      More blocks
    </button>
  </div>
</div>

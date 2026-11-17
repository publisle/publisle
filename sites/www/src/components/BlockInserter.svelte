<script lang="ts">
  // Always-visible inserter for the common blocks. One tap inserts; each
  // choice carries a static miniature of the compiled block. Pinned by the
  // caller to the top of the editor section.
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

<div role="group" aria-label="Add a block">
  <p class="mb-1.5 text-xs font-medium text-muted {empty ? 'sm:text-sm' : ''}">
    {empty ? "Add a block to start" : "Add a block"}
  </p>
  <div
    class="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1.5 sm:flex-wrap sm:overflow-visible sm:pb-0 lg:flex-nowrap lg:overflow-x-auto lg:pb-1.5"
  >
    {#each items as item (item.type)}
      <div
        class="group relative flex min-h-[5.25rem] w-28 shrink-0 snap-start flex-col gap-1 rounded-lg border border-line bg-bg p-1.5 transition-colors hover:border-accent has-[:focus-visible]:border-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/50 sm:w-[6.75rem]"
      >
        <div class="inserter-sample h-14 overflow-hidden rounded bg-surface px-1.5 py-1">
          <BlockSample type={item.type} label={item.label} />
        </div>
        <span class="truncate text-center text-xs font-medium" aria-hidden="true">{item.label}</span>
        <button
          type="button"
          class="absolute inset-0 rounded-lg focus:outline-none"
          aria-label="Add {item.label.toLowerCase()}"
          onclick={() => onInsert(item.type)}
        ></button>
      </div>
    {/each}
    <button
      type="button"
      class="flex min-h-[5.25rem] w-28 shrink-0 snap-start flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-line px-2 text-xs font-medium text-muted transition-colors hover:border-accent hover:text-accent sm:w-[6.75rem]"
      title="More blocks (Ctrl+K)"
      onclick={onMore}
    >
      <span aria-hidden="true" class="text-lg leading-none">⋯</span>
      More blocks
    </button>
  </div>
</div>

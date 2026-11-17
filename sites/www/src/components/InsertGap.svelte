<script lang="ts">
  // Quiet insertion control between blocks: one tap adds a paragraph here, or
  // open the inline row to pick another common type at this position.
  interface Item {
    readonly type: string;
    readonly label: string;
  }

  interface Props {
    items: readonly Item[];
    /** 1-based position of the block above, for assistive names. */
    position: number;
    onInsert: (type: string) => void;
  }

  let { items, position, onInsert }: Props = $props();

  let open = $state(false);

  function insert(type: string): void {
    open = false;
    onInsert(type);
  }
</script>

<div
  role="group"
  aria-label="Insert after block {position}"
  class="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-dashed border-line/70 pt-1"
>
  <button
    type="button"
    class="inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-sm text-muted hover:text-accent lg:min-h-8 lg:px-2 lg:text-xs"
    aria-label="Insert paragraph after block {position}"
    onclick={() => insert("publisle:paragraph")}
  >
    <span aria-hidden="true">+</span> Paragraph
  </button>
  <button
    type="button"
    class="inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-sm text-muted hover:text-accent lg:min-h-8 lg:px-2 lg:text-xs"
    aria-expanded={open}
    aria-label="Choose a block type to insert after block {position}"
    onclick={() => (open = !open)}
  >
    Other type <span aria-hidden="true">{open ? "▴" : "▾"}</span>
  </button>
  {#if open}
    <div class="flex w-full flex-wrap gap-1.5 pb-1">
      {#each items as item (item.type)}
        <button
          type="button"
          class="inline-flex min-h-11 items-center rounded-full border border-line px-3.5 text-sm hover:border-accent hover:text-accent lg:min-h-8 lg:px-3 lg:text-xs"
          aria-label="Insert {item.label.toLowerCase()} after block {position}"
          onclick={() => insert(item.type)}
        >
          {item.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

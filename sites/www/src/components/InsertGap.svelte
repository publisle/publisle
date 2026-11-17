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
  class="flex flex-col items-center gap-2 py-1"
>
  <div class="flex w-full items-center gap-3">
    <span class="h-px flex-1 bg-line/80" aria-hidden="true"></span>
    <button
      type="button"
      class="inline-flex size-9 items-center justify-center rounded-full border border-line text-muted hover:border-accent hover:text-accent"
      aria-label="Insert paragraph after block {position}"
      onclick={() => insert("publisle:paragraph")}
    >
      <span aria-hidden="true">+</span>
    </button>
    <button
      type="button"
      class="inline-flex h-9 items-center rounded-full border border-line px-3 text-xs text-muted hover:border-accent hover:text-accent"
      aria-expanded={open}
      aria-label="Choose a block type to insert after block {position}"
      onclick={() => (open = !open)}
    >
      {open ? "Close" : "Other"}
    </button>
    <span class="h-px flex-1 bg-line/80" aria-hidden="true"></span>
  </div>
  {#if open}
    <div class="flex w-full flex-wrap justify-center gap-2">
      {#each items as item (item.type)}
        <button
          type="button"
          class="inline-flex min-h-10 items-center rounded-full border border-line bg-bg px-3.5 text-sm hover:border-accent hover:text-accent"
          aria-label="Insert {item.label.toLowerCase()} after block {position}"
          onclick={() => insert(item.type)}
        >
          {item.label}
        </button>
      {/each}
    </div>
  {/if}
</div>

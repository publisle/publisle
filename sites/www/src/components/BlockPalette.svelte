<script lang="ts">
  // Searchable block-insertion palette (Ctrl+K). Entries are grouped by
  // category and filtered across label, description, and type id.
  import { tick } from "svelte";
  import BlockSample from "./BlockSample.svelte";

  interface BlockEntry {
    readonly type: string;
    readonly label: string;
    readonly description: string;
  }
  interface BlockCategory {
    readonly id: string;
    readonly label: string;
    readonly entries: readonly BlockEntry[];
  }

  interface Props {
    open: boolean;
    categories: readonly BlockCategory[];
    oninsert: (type: string) => void;
    onclose: () => void;
  }

  let { open, categories, oninsert, onclose }: Props = $props();

  let query = $state("");
  let active = $state(0);
  let search = $state<HTMLInputElement | null>(null);
  let dialog = $state<HTMLDivElement | null>(null);

  const filtered = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    const groups = categories
      .map((category) => ({
        ...category,
        entries: category.entries.filter(
          (entry) =>
            needle === "" ||
            entry.label.toLowerCase().includes(needle) ||
            entry.description.toLowerCase().includes(needle) ||
            entry.type.toLowerCase().includes(needle),
        ),
      }))
      .filter((category) => category.entries.length > 0);
    return groups;
  });

  const flat = $derived(filtered.flatMap((group) => group.entries));
  const activeEntry = $derived(flat[active]);

  $effect(() => {
    if (open) {
      query = "";
      active = 0;
      void tick().then(() => search?.focus());
    }
  });

  function insert(type: string): void {
    oninsert(type);
    onclose();
  }

  function move(delta: number): void {
    if (flat.length === 0) return;
    active = (active + delta + flat.length) % flat.length;
    void tick().then(() => {
      dialog
        ?.querySelector('[data-active="true"]')
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  function onkeydown(event: KeyboardEvent): void {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onclose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter") {
      const entry = flat[active];
      if (entry) {
        event.preventDefault();
        insert(entry.type);
      }
    } else if (event.key === "Tab") {
      // Minimal focus trap: keep focus cycling inside the dialog.
      const focusable = dialog?.querySelectorAll<HTMLElement>(
        "input, button",
      );
      if (!focusable || focusable.length === 0) return;
      const list = [...focusable];
      const index = list.indexOf(document.activeElement as HTMLElement);
      event.preventDefault();
      const next =
        event.shiftKey
          ? list[(index - 1 + list.length) % list.length]
          : list[(index + 1) % list.length];
      next?.focus();
    }
  }
</script>

<svelte:window onkeydown={onkeydown} />

{#if open}
  <div
    class="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-[10vh] backdrop-blur-sm"
    onclick={(event) => {
      if (event.target === event.currentTarget) onclose();
    }}
    role="presentation"
  >
    <div
      bind:this={dialog}
      role="dialog"
      aria-modal="true"
      aria-label="Add block"
      class="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-bg shadow-2xl"
    >
      <input
        bind:this={search}
        bind:value={query}
        oninput={() => (active = 0)}
        type="text"
        placeholder="Search blocks…"
        aria-label="Search blocks"
        class="w-full border-b border-line bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted"
      />
      <div class="grid max-h-[38vh] gap-y-1 overflow-y-auto p-2 sm:max-h-[40vh] sm:grid-cols-2">
        {#if flat.length === 0}
          <p class="px-2 py-6 text-center text-sm text-muted">
            No blocks match “{query}”.
          </p>
        {:else}
          {#each filtered as group (group.id)}
            <p class="col-span-full px-2 pb-1 pt-3 text-xs font-medium tracking-wide text-muted uppercase">
              {group.label}
            </p>
            {#each group.entries as entry (entry.type)}
              {@const flatIndex = flat.indexOf(entry)}
              <button
                type="button"
                data-active={flatIndex === active}
                class="flex min-h-11 w-full items-baseline gap-2 rounded-lg px-3 py-1.5 text-left {flatIndex === active
                  ? 'bg-surface ring-1 ring-accent/50'
                  : 'hover:bg-surface'}"
                onclick={() => insert(entry.type)}
                onmousemove={() => (active = flatIndex)}
                onfocus={() => (active = flatIndex)}
              >
                <span class="min-w-0">
                  <span class="block text-sm font-medium">{entry.label}</span>
                  <span class="block truncate text-xs text-muted">
                    {entry.description}
                  </span>
                </span>
              </button>
            {/each}
          {/each}
        {/if}
      </div>
      {#if activeEntry}
        <div class="flex items-center gap-3 border-t border-line bg-surface px-4 py-3">
          <div class="h-24 w-36 shrink-0 overflow-hidden rounded-md border border-line bg-bg px-2 py-1.5 sm:w-48">
            <BlockSample type={activeEntry.type} label={activeEntry.label} size="lg" />
          </div>
          <div class="min-w-0">
            <p class="text-sm font-medium">{activeEntry.label}</p>
            <p class="text-xs text-muted">{activeEntry.description}</p>
          </div>
        </div>
      {/if}
      <p class="border-t border-line px-4 py-2 text-xs text-muted">
        Enter to insert · ↑↓ to navigate · Esc to close
      </p>
    </div>
  </div>
{/if}

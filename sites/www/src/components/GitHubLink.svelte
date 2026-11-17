<script lang="ts">
  import { onMount } from "svelte";

  let { layout = "inline" }: { layout?: "inline" | "menu" } = $props();

  let stars = $state<number | undefined>(undefined);
  const href = "https://github.com/publisle/publisle";

  onMount(() => {
    const controller = new AbortController();
    void fetch("https://api.github.com/repos/publisle/publisle", {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body: { stargazers_count?: unknown }) => {
        if (typeof body.stargazers_count === "number")
          stars = body.stargazers_count;
      })
      .catch(() => {});
    return () => controller.abort();
  });

  const label = $derived(
    stars === undefined
      ? "Publisle on GitHub"
      : `Publisle on GitHub, ${stars.toLocaleString("en")} stars`,
  );

  function format(count: number): string {
    return new Intl.NumberFormat("en", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(count);
  }
</script>

<a
  {href}
  rel="me noopener"
  aria-label={label}
  class={layout === "menu"
    ? "mt-1 flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-sm font-medium text-muted transition hover:border-accent hover:text-accent"
    : "ml-1 inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-muted transition hover:border-accent hover:text-accent"}
>
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="currentColor"
    aria-hidden="true"
  >
    <path
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
    ></path>
  </svg>
  <span>GitHub</span>
  <span class="inline-flex min-w-10 items-center justify-end gap-1 tabular-nums">
    {#if stars !== undefined}
      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path
          d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25z"
        ></path>
      </svg>
      {format(stars)}
    {/if}
  </span>
</a>

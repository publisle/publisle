<script lang="ts">
  import { onMount } from "svelte";

  type Theme = "light" | "dark";

  let theme: Theme = $state("dark");

  onMount(() => {
    const sync = () => {
      const current = document.documentElement.dataset.theme;
      theme = current === "dark" || current === "light" ? current
        : window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    };
    sync();
    document.addEventListener("astro:page-load", sync);
    return () => document.removeEventListener("astro:page-load", sync);
  });

  function toggle(): void {
    theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("publisle-theme", theme); } catch {}
  }
</script>

<button
  type="button"
  class="rounded-md border border-line p-2 text-muted transition hover:border-accent hover:text-accent"
  aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
  title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
  onclick={toggle}
>
  {#if theme === "dark"}
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4"></circle>
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path>
    </svg>
  {:else}
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
    </svg>
  {/if}
</button>

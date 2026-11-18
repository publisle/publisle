<script lang="ts">
  import GitHubLink from "./GitHubLink.svelte";
  // Mobile navigation: hamburger toggle plus a drop-down panel under the
  // sticky header. Desktop keeps static inline links; this island renders
  // below the sm breakpoint only.
  const links = [
    { href: "/docs/", label: "Docs" },
    { href: "/examples/", label: "Examples" },
    { href: "/playground/", label: "Playground" },
    { href: "/mcp/", label: "MCP" },
  ];
  let open = $state(false);
  let path = $state("/");

  function sync(): void {
    path = location.pathname;
    open = false;
  }

  $effect(() => {
    sync();
    document.addEventListener("astro:page-load", sync);
    return () => document.removeEventListener("astro:page-load", sync);
  });

  function isActive(href: string): boolean {
    return href === "/" ? path === "/" : path.startsWith(href);
  }

  function onkeydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && open) {
      open = false;
    }
  }
</script>

<svelte:window onkeydown={onkeydown} />

<div class="sm:hidden">
  <button
    type="button"
    aria-expanded={open}
    aria-controls="mobile-nav"
    aria-label={open ? "Close menu" : "Open menu"}
    class="rounded-md border border-line p-2 text-muted transition hover:border-accent hover:text-accent"
    onclick={() => (open = !open)}
  >
    {#if open}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M18 6 6 18M6 6l12 12"></path>
      </svg>
    {:else}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h16"></path>
      </svg>
    {/if}
  </button>

  {#if open}
    <div
      id="mobile-nav"
      class="absolute inset-x-0 top-full z-40 border-b border-line bg-bg shadow-xl"
    >
      <nav aria-label="Mobile" class="flex flex-col gap-1 p-3">
        {#each links as link (link.href)}
          <a
            href={link.href}
            aria-current={isActive(link.href) ? "page" : undefined}
            class="rounded-lg px-3 py-2.5 text-sm font-medium {isActive(link.href)
              ? 'bg-surface text-accent'
              : 'text-ink hover:bg-surface'}"
          >
            {link.label}
          </a>
        {/each}
        <GitHubLink layout="menu" />
      </nav>
    </div>
  {/if}
</div>

<script lang="ts">
  import { onMount } from "svelte";
  import { API_URL } from "../lib/api";
  import {
    abbreviate,
    browserTransport,
    DEFAULT_INPUTS,
    hostedTransport,
    probeHosted,
    runSession,
    type DemoResult,
    type Transport,
    type TranscriptEntry,
  } from "../lib/mcp-demo";

  let mode = $state<"checking" | "hosted" | "browser">("checking");
  let forceBrowser = $state(false);
  let running = $state(false);
  let title = $state(DEFAULT_INPUTS.title);
  let paragraph = $state(DEFAULT_INPUTS.paragraph);
  let equation = $state(DEFAULT_INPUTS.equation);
  let entries = $state<TranscriptEntry[]>([]);
  let result = $state<DemoResult>({});
  let pdfUrl = $state<string | undefined>(undefined);
  let announce = $state("");
  let abort: AbortController | undefined;

  const host = new URL(API_URL).host;

  onMount(() => {
    void detect();
    return () => {
      abort?.abort();
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  });

  async function detect(): Promise<void> {
    mode = "checking";
    mode = !forceBrowser && (await probeHosted(API_URL)) ? "hosted" : "browser";
  }

  async function choose(browser: boolean): Promise<void> {
    if (running) return;
    forceBrowser = browser;
    await detect();
  }

  function reset(): void {
    abort?.abort();
    entries = [];
    result = {};
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    pdfUrl = undefined;
    announce = "";
  }

  async function run(): Promise<void> {
    if (running) return;
    reset();
    running = true;
    abort = new AbortController();
    announce = "Running the MCP session…";
    try {
      const transport: Transport =
        mode === "hosted" ? hostedTransport(API_URL) : await browserTransport();
      result = await runSession(
        transport,
        { title: title.trim() || DEFAULT_INPUTS.title, paragraph: paragraph.trim() || DEFAULT_INPUTS.paragraph, equation: equation.trim() || DEFAULT_INPUTS.equation },
        (entry) => {
          entries = [...entries, entry];
          announce = `Step ${String(entry.id)}, ${entry.label}: ${entry.summary}`;
        },
        abort.signal,
      );
      if (result.pdf) pdfUrl = URL.createObjectURL(result.pdf);
      announce = "Session finished.";
    } catch (error) {
      announce = error instanceof Error ? error.message : "The session failed.";
    } finally {
      running = false;
    }
  }

  const failures = $derived(entries.filter((entry) => !entry.ok).length);
</script>

<div class="space-y-6">
  <section class="rounded-xl border border-line bg-surface p-4 sm:p-6" aria-labelledby="mcp-session">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="mcp-session" class="font-display text-xl font-semibold">Run a session</h2>
        <p class="mt-1 text-sm text-muted">
          An assistant would make these calls. Change the text, then watch the protocol and the result.
        </p>
      </div>
      <p class="rounded-full border border-line px-3 py-1 text-xs" role="status" data-mcp-mode={mode}>
        {#if mode === "checking"}
          Checking {host}…
        {:else if mode === "hosted"}
          Live: calling {host}/mcp
        {:else}
          Offline mode: the same handler runs in your browser
        {/if}
      </p>
    </div>

    <div class="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
      <label class="block text-sm">
        <span class="font-medium">Title</span>
        <input class="mt-1 min-h-11 w-full rounded-md border border-line bg-input px-3 lg:min-h-9" bind:value={title} maxlength="120" />
      </label>
      <label class="block text-sm">
        <span class="font-medium">Equation (LaTeX)</span>
        <input class="mt-1 min-h-11 w-full rounded-md border border-line bg-input px-3 font-mono lg:min-h-9" bind:value={equation} maxlength="200" />
      </label>
      <label class="block text-sm md:col-span-2">
        <span class="font-medium">Paragraph</span>
        <textarea class="mt-1 min-h-24 w-full rounded-md border border-line bg-input px-3 py-2" bind:value={paragraph} maxlength="600"></textarea>
      </label>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" class="min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-bg disabled:opacity-50 lg:min-h-9" disabled={running || mode === "checking"} aria-busy={running} onclick={() => void run()}>
        {running ? "Running…" : entries.length ? "Run again" : "Run the session"}
      </button>
      {#if entries.length && !running}
        <button type="button" class="min-h-11 rounded-md border border-line px-4 text-sm text-muted hover:border-accent hover:text-accent lg:min-h-9" onclick={reset}>Clear</button>
      {/if}
      {#if mode === "hosted"}
        <button type="button" class="min-h-11 rounded-md border border-line px-4 text-sm text-muted hover:border-accent hover:text-accent disabled:opacity-50 lg:min-h-9" disabled={running} onclick={() => void choose(true)}>Run in my browser instead</button>
      {:else if mode === "browser"}
        <button type="button" class="min-h-11 rounded-md border border-line px-4 text-sm text-muted hover:border-accent hover:text-accent disabled:opacity-50 lg:min-h-9" disabled={running} onclick={() => { forceBrowser = false; void detect(); }}>Try the live endpoint</button>
      {/if}
    </div>
    <p class="sr-only" role="status" aria-live="polite">{announce}</p>
  </section>

  {#if entries.length}
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section aria-labelledby="mcp-transcript" class="min-w-0">
        <h2 id="mcp-transcript" class="font-display text-xl font-semibold">Transcript</h2>
        <p class="mt-1 text-xs text-muted">
          {entries.length} {entries.length === 1 ? "call" : "calls"}{failures ? `, ${failures} reported a problem` : ""}. Open one to see the exact JSON.
        </p>
        <ol class="mt-3 space-y-2">
          {#each entries as entry (entry.id)}
            <li>
              <details class="rounded-lg border border-line bg-surface">
                <summary class="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                  <span class="font-mono text-xs text-muted">{entry.id}</span>
                  <code class="font-mono">{entry.label}</code>
                  <span class="text-xs {entry.ok ? 'text-muted' : 'text-danger'}">{entry.ok ? "ok" : "problem"} · HTTP {entry.status} · {entry.ms} ms</span>
                  <span class="basis-full text-xs {entry.ok ? 'text-muted' : 'text-danger'}">{entry.summary}</span>
                </summary>
                <div class="space-y-2 border-t border-line p-3">
                  <p class="text-xs text-muted">{entry.note}</p>
                  <p class="text-xs font-semibold">Request</p>
                  <pre class="max-h-64 overflow-auto rounded-md border border-line bg-raised p-2 font-mono text-xs"><code>{abbreviate(entry.request)}</code></pre>
                  <p class="text-xs font-semibold">Response</p>
                  <pre class="max-h-64 overflow-auto rounded-md border border-line bg-raised p-2 font-mono text-xs"><code>{entry.response === undefined ? "(no body)" : abbreviate(entry.response)}</code></pre>
                </div>
              </details>
            </li>
          {/each}
        </ol>
      </section>

      <div class="min-w-0 space-y-6">
        {#if result.html}
          <section aria-label="Compiled preview" class="publication-wide max-h-[70svh] overflow-y-auto rounded-xl border border-line bg-surface p-4 sm:p-6">
            <h2 class="mb-1 font-display text-lg font-semibold">HTML preview</h2>
            <p class="mb-3 text-xs text-muted">Returned by <code>render_html</code>.</p>
            <div class="publisle-preview">{@html result.html}</div>
          </section>
        {/if}
        {#if pdfUrl}
          <section aria-label="PDF result" class="rounded-xl border border-line bg-surface p-4 sm:p-6">
            <h2 class="mb-1 font-display text-lg font-semibold">PDF</h2>
            <p class="mb-3 text-xs text-muted">Returned by <code>compile_pdf</code>, compiled by the Rust engine.</p>
            <iframe title="Exported PDF" src={pdfUrl} class="h-[32rem] w-full rounded-md border border-line bg-bg"></iframe>
            <a class="mt-3 inline-block text-sm text-accent hover:underline" href={pdfUrl} download="publisle-mcp.pdf">Download the PDF</a>
          </section>
        {:else if !running && mode === "browser" && entries.length}
          <p class="rounded-lg border border-line bg-surface p-4 text-sm text-muted">
            PDF export needs the hosted endpoint, where the Rust compiler runs. In offline mode <code>compile_pdf</code> reports that as a tool error, which is what an assistant would see.
          </p>
        {/if}
      </div>
    </div>
  {/if}
</div>

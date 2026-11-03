<script lang="ts">
  // Playground shell: Edit/Preview view switcher, searchable block palette,
  // source views, and the compiled preview. One component owns the shared
  // editor state; loaded only on /playground.
  import { onMount, tick, mount as svelteMount, unmount as svelteUnmount } from "svelte";
  import {
    blockCategories,
    blockDescriptions,
    blockLabels,
    blockTypes,
    createPlaygroundRegistry,
    DocumentEditor,
  } from "@publisle/playground/core";
  import BlockEditor from "@publisle/playground/BlockEditor.svelte";
  import MathBlockEditor from "@publisle/playground/MathBlockEditor.svelte";
  import { interactiveSchematicDefinition } from "@publisle/blocks-technical";
  import { attachArticle } from "@publisle/adapter-astro/runtime";
  import { prepare } from "@publisle/core";
  import { compilePublicationAsync, publicationReaderManifest } from "@publisle/adapter-core/async";
  import starterDocument from "../lib/starter-document.json";
  import { fetchHealth, fetchPdfTemplates, compilePdf, PDF_ENABLED, type ApiHealth, type PdfTemplate } from "../lib/api";
  import {
    playgroundExamples,
    type PlaygroundExample,
  } from "../lib/playground-examples";
  import BlockPalette from "./BlockPalette.svelte";
  import SchematicIsland from "./islands/Schematic.svelte";

  // Live island runtime for the preview: schematic islands mount the real
  // counter instead of their static fallback.
  const previewEnvironment = {
    implementations: {
      "publisle:interactive-schematic": (): Promise<unknown> =>
        Promise.resolve({ default: SchematicIsland }),
    },
    mount: (module: unknown, target: HTMLElement, props: unknown): unknown =>
      svelteMount((module as { default: typeof SchematicIsland }).default, {
        target,
        props: props as Record<string, unknown>,
      }),
    unmount: (instance: unknown): void => {
      svelteUnmount(instance as never);
    },
  };

  const registry = createPlaygroundRegistry([interactiveSchematicDefinition]);

  const STARTER_MARKDOWN = `---
title: "Hello, Publisle"
authors:
  - name: Ada Example
---

Edit this document and see the result beside it. Your draft saves on this device.

## Blocks

- Structured blocks keep IDs, captions, and labels
- Math stays TeX: $e^{i\\pi} + 1 = 0$
- Press Ctrl+K to add blocks from the searchable palette

PDF export works out of the box: this sample already carries a title and author.
`;

  const editor = new DocumentEditor(undefined, registry);
  editor.fromJson(JSON.stringify(starterDocument));

  let markdownLoader: Promise<typeof import("@publisle/markdown")> | undefined;
  function markdownModule() {
    return markdownLoader ??= import("@publisle/markdown").catch((error: unknown) => { markdownLoader = undefined; throw error; });
  }
  let markdownPending = $state(0);
  async function importMarkdown(source: string) {
    markdownPending += 1;
    try {
    const { fromMarkdown } = await markdownModule();
    const result = fromMarkdown(source, { resolveSchemaVersion: (type) => registry.get(type)?.schemaVersion });
    if (result.document) editor.setDocument(result.document);
    return result;
    } catch {
      return { diagnostics: [{ level: "error" as const, code: "markdown-load-failed", message: "Markdown support could not load. Reload to retry." }] };
    } finally { markdownPending -= 1; }
  }
  async function exportMarkdown() { return (await markdownModule()).toMarkdown(editor.document); }
  let version = $state(0);

  let view = $state<"edit" | "preview">("edit");
  let mode = $state<"blocks" | "markdown" | "json">("blocks");
  let markdownText = $state(STARTER_MARKDOWN);
  let jsonText = $state("");
  let markdownInvalid = false;
  let jsonInvalid = false;
  let markdownDocument = editor.toJson();
  let jsonDocument = "";
  let notice = $state<string | undefined>(undefined);
  let health = $state<ApiHealth | undefined>(undefined);
  let pdfTemplates = $state<readonly PdfTemplate[]>([]);
  let pdfTemplate = $state("article");
  let pdfEngine = $state<"pdflatex" | "lualatex" | "rust">("lualatex");
  let pdfTitle = $state("");
  let pdfAuthors = $state("");
  let pdfAffiliation = $state("");
  let pdfCountry = $state("");
  let pdfBusy = $state(false);
  let pdfElapsed = $state(0);
  let citationResolver = $state<typeof import("../lib/preview-citations").previewCitations>();
  let pdfAbort: AbortController | undefined;
  let pdfDownloadUrl: string | undefined;
  const engineLabels: Record<string, string> = {
    lualatex: "LaTeX · LuaLaTeX (~45 s)",
    pdflatex: "LaTeX · pdfLaTeX",
    rust: "Fast · experimental (~3 s)",
  };
  const selectedPdfTemplate = $derived(pdfTemplates.find((item) => item.id === pdfTemplate));

  function selectPdfTemplate(): void {
    const selected = pdfTemplates.find((item) => item.id === pdfTemplate);
    pdfEngine = selected?.engines.includes("lualatex") ? "lualatex" : selected?.engines.includes("pdflatex") ? "pdflatex" : selected?.engines[0] ?? "lualatex";
  }

  async function exportPdf(): Promise<void> {
    await flushSource();
    if ((mode === "markdown" && markdownInvalid) || (mode === "json" && jsonInvalid)) {
      notice = "Fix the invalid editor source before exporting.";
      return;
    }
    if (pdfBusy) return;
    const document = structuredClone(editor.document);
    const title = pdfTitle.trim() || document.metadata?.title;
    const authors = pdfAuthors.trim() ? pdfAuthors.split(";").map((name) => ({ name: name.trim(), ...(pdfAffiliation.trim() ? { affiliation: pdfAffiliation.trim() } : {}) })).filter((author) => author.name) : document.metadata?.authors;
    if (!title || !authors?.length) { notice = "PDF export requires a title and at least one author. Enter them in PDF options or document metadata."; return; }
    document.metadata = { ...document.metadata, title, authors };
    pdfBusy = true;
    notice = "Compiling PDF…";
    pdfElapsed = 0;
    const started = performance.now();
    const elapsedTimer = setInterval(() => { pdfElapsed = Math.floor((performance.now() - started) / 1000); }, 1000);
    pdfAbort = new AbortController();
    try {
      const result = await compilePdf({ document, template: pdfTemplate, engine: pdfEngine, ...(pdfCountry.trim() && pdfTemplate === "acm-journal" ? { data: { country: pdfCountry.trim() } } : {}) }, pdfAbort.signal);
      if (!result.ok) { notice = pdfAbort.signal.aborted ? "PDF export cancelled." : result.message; return; }
      if (pdfDownloadUrl) URL.revokeObjectURL(pdfDownloadUrl);
      pdfDownloadUrl = URL.createObjectURL(result.value.pdf);
      const link = window.document.createElement("a");
      link.href = pdfDownloadUrl;
      link.download = "publisle.pdf";
      link.click();
      notice = result.value.diagnostics.length ? `PDF downloaded. ${result.value.diagnostics.map((entry) => entry.message).join(" ")}` : "PDF downloaded.";
      const downloadedUrl = pdfDownloadUrl;
      setTimeout(() => { URL.revokeObjectURL(downloadedUrl); if (pdfDownloadUrl === downloadedUrl) pdfDownloadUrl = undefined; }, 1000);
    } finally { clearInterval(elapsedTimer); pdfBusy = false; pdfAbort = undefined; }
  }

  let selectedId = $state<string | undefined>(undefined);
  let paletteOpen = $state(false);
  let previewEl = $state<HTMLDivElement | null>(null);

  let draftReady = $state(false);
  let storageAvailable = $state(true);
  let sourcePending = false;
  let sourceFlight: Promise<void> | undefined;
  let sourceTimer: ReturnType<typeof setTimeout> | undefined;
  const DRAFT_KEY = "publisle-draft-v1";

  onMount(() => {
    let disposed = false;
    void import("../lib/preview-citations").then((module) => {
      if (!disposed) citationResolver = module.previewCitations;
    }).catch(() => { if (!disposed) notice = "Citation formatting could not load. Reload to retry."; });
    const unsubscribe = editor.subscribe(() => { version += 1; });
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft.version === 1 && typeof draft.document === "string") {
          editor.fromJson(draft.document);
          markdownText = typeof draft.markdown === "string" ? draft.markdown : "";
          jsonText = typeof draft.json === "string" ? draft.json : editor.toJson();
          markdownInvalid = draft.markdownInvalid === true;
          jsonInvalid = draft.jsonInvalid === true;
          markdownDocument = typeof draft.markdownDocument === "string" ? draft.markdownDocument : "";
          jsonDocument = typeof draft.jsonDocument === "string" ? draft.jsonDocument : "";
          if (["blocks", "markdown", "json"].includes(draft.mode)) mode = draft.mode;
          if (mode === "markdown") {
            if (typeof draft.markdown === "string") void applyMarkdown();
            else {
              const restored = editor.toJson();
              void exportMarkdown().then((result) => {
                if (editor.toJson() === restored && markdownText === "") {
                  markdownText = result.markdown ?? "";
                  markdownDocument = restored;
                }
              }).catch(() => { notice = "Markdown support could not load. Reload to retry."; });
            }
          }
          if (mode === "json") applyJson();
        }
      }
    } catch { storageAvailable = false; }
    const example = playgroundExamples.find((item) => item.id === new URLSearchParams(location.search).get("example"));
    if (example) {
      loadExample(example);
      const url = new URL(location.href);
      url.searchParams.delete("example");
      history.replaceState(history.state, "", url);
    }
    draftReady = true;
    return () => { disposed = true; unsubscribe(); clearTimeout(sourceTimer); pdfAbort?.abort(); if (pdfDownloadUrl) URL.revokeObjectURL(pdfDownloadUrl); };
  });

  $effect(() => {
    void version;
    if (!draftReady) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        version: 1, document: editor.toJson(), mode,
        markdown: markdownText, json: jsonText, markdownInvalid, jsonInvalid, markdownDocument, jsonDocument,
      }));
    } catch { storageAvailable = false; }
  });

  async function flushSource(): Promise<void> {
    clearTimeout(sourceTimer);
    if (!sourcePending) { await sourceFlight; return; }
    sourcePending = false;
    if (mode === "markdown") { sourceFlight = applyMarkdown(); await sourceFlight; }
    if (mode === "json") applyJson();
  }

  function scheduleSource(): void {
    sourcePending = true;
    clearTimeout(sourceTimer);
    sourceTimer = setTimeout(flushSource, 200);
  }

  async function changeMode(next: "blocks" | "markdown" | "json"): Promise<void> {
    if (next === mode) return;
    await flushSource();
    if (next === "markdown" && !markdownInvalid && markdownDocument !== editor.toJson()) {
      try { markdownText = (await exportMarkdown()).markdown ?? ""; }
      catch { notice = "Markdown support could not load. Reload to retry."; return; }
      markdownDocument = editor.toJson();
    }
    if (next === "json" && !jsonInvalid && jsonDocument !== editor.toJson()) {
      jsonText = editor.toJson();
      jsonDocument = editor.toJson();
    }
    mode = next;
  }

  // Attach the island runtime to the compiled preview; re-runs (disposing the
  // previous attachment) whenever the compilation changes.
  $effect(() => {
    const target = previewEl;
    const manifest = compiled.manifest;
    if (!target || compiled.error || !manifest) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    // Restoring a draft in onMount can replace the initial HTML in the same
    // flush. Attach only after that DOM update, and ignore superseded work.
    void tick().then(() => {
      if (!cancelled) dispose = attachArticle(target, manifest, previewEnvironment);
    });
    return () => { cancelled = true; dispose?.(); };
  });

  // $state does not deep-proxy the DocumentEditor class instance, so the
  // block list must read `version` to re-render on editor mutations.
  const blocks = $derived.by(() => {
    void version;
    return editor.document.blocks;
  });
  const previewTitle = $derived.by(() => { void version; return editor.document.metadata?.title; });

  const types = blockTypes();
  const labels = blockLabels();
  const descriptions = blockDescriptions();
  const paletteCategories = blockCategories().map((category) => ({
    id: category.id,
    label: category.label,
    entries: category.types
      .filter((type) => types.includes(type))
      .map((type) => ({
        type,
        label: labels[type] ?? type,
        description: descriptions[type] ?? "",
      })),
  }));

  let previewBusy = $state(true);
  let compiled = $state<{ html: string; warnings: number; error: string; manifest: ReturnType<typeof publicationReaderManifest> | undefined }>({ html: "", warnings: 0, error: "", manifest: undefined });
  $effect(() => {
    void version;
    previewBusy = true;
    compiled = { html: "", warnings: 0, error: "", manifest: undefined };
    if (markdownPending > 0) return;
    const source = editor.document;
    const citations = citationResolver?.(source);
    let active = true;
    void (async () => {
    try {
      const result = prepare(source, { registry });
      if (!result.document) {
        return {
          html: "",
          warnings: result.diagnostics.length,
          error: result.diagnostics
            .map((item) => `${item.code}: ${item.message}`)
            .join("\n"),
          manifest: undefined,
        };
      }
      const artifact = await compilePublicationAsync(result.document, citations);
      return {
        html: artifact.html,
        warnings: artifact.diagnostics.length,
        error: "",
        manifest: publicationReaderManifest(artifact),
      };
    } catch (error) {
      return {
        html: "",
        warnings: 0,
        error: error instanceof Error ? error.message : "Compilation failed.",
        manifest: undefined,
      };
    }
    })().then((result) => { if (active) { compiled = result; previewBusy = false; } });
    return () => { active = false; };
  });

  async function setView(next: "edit" | "preview"): Promise<void> {
    view = next;
    await flushSource();
  }

  async function addBlock(type: string): Promise<void> {
    await changeMode("blocks");
    const selectedIndex = blocks.findIndex(
      (block) => block.id === selectedId,
    );
    const insertAt =
      selectedIndex >= 0 ? selectedIndex + 1 : blocks.length;
    editor.addBlock(type, insertAt);
    selectedId = editor.document.blocks[insertAt]?.id;
    view = "edit";
    notice = undefined;
  }

  function duplicate(id: string): void {
    const duplicateId = editor.duplicateBlock(id);
    if (duplicateId) selectedId = duplicateId;
    version += 1;
  }

  async function applyMarkdown(): Promise<void> {
    const result = await importMarkdown(markdownText);
    markdownInvalid = result.diagnostics.some((item) => item.level === "error");
    markdownDocument = editor.toJson();
    notice =
      result.diagnostics.length > 0
        ? result.diagnostics
            .map((item) => `${item.code}: ${item.message}`)
            .join(" · ")
        : undefined;
    version += 1;
  }

  function applyJson(): void {
    const result = editor.fromJson(jsonText);
    jsonInvalid = result.diagnostics.some((item) => item.level === "error");
    jsonDocument = editor.toJson();
    notice =
      result.diagnostics.length > 0
        ? result.diagnostics
            .map((item) => `${item.code}: ${item.message}`)
            .join(" · ")
        : undefined;
    version += 1;
  }

  async function loadExample(example: PlaygroundExample): Promise<void> {
    clearTimeout(sourceTimer);
    sourcePending = false;
    const imported = await importMarkdown(example.markdown);
    if (imported.diagnostics.some((item) => item.level === "error")) {
      notice = imported.diagnostics.map((item) => item.message).join(" ");
      return;
    }
    markdownText = example.markdown;
    jsonText = editor.toJson();
    markdownInvalid = jsonInvalid = false;
    markdownDocument = jsonDocument = editor.toJson();
    selectedId = undefined;
    notice = `Loaded "${example.title}".`;
    view = "edit";
    version += 1;
  }

  function reset(): void {
    clearTimeout(sourceTimer);
    sourcePending = false;
    editor.fromJson(JSON.stringify(starterDocument));
    markdownText = STARTER_MARKDOWN;
    jsonText = editor.toJson();
    markdownInvalid = jsonInvalid = false;
    markdownDocument = jsonDocument = editor.toJson();
    selectedId = undefined;
    mode = "blocks";
    notice = undefined;
    setView("edit");
    version += 1;
  }

  function onWindowKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const typing =
      target !== null &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      paletteOpen = !paletteOpen;
      return;
    }
    if (event.key === "/" && !typing && !paletteOpen) {
      event.preventDefault();
      paletteOpen = true;
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      setView(view === "edit" ? "preview" : "edit");
      return;
    }
    if (event.key === "Escape" && !paletteOpen && view === "preview") {
      setView("edit");
    }
  }

  $effect(() => {
    if (PDF_ENABLED) {
      void fetchHealth().then((result) => {
        if (result.ok) health = result.value;
      });
      void fetchPdfTemplates().then((templates) => { pdfTemplates = templates; selectPdfTemplate(); });
    }
  });
</script>

<svelte:window onkeydown={onWindowKeydown} />

<div class="flex h-full min-h-[70vh] flex-col gap-4">
  <div
    class="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-bg px-2 py-2"
  >
    <div
      class="flex overflow-hidden rounded-lg border border-line lg:hidden"
      role="tablist"
      aria-label="Playground view"
    >
      <button
        type="button"
        role="tab"
        aria-selected={view === "edit"}
        class="px-4 py-1.5 text-sm {view === 'edit'
          ? 'bg-surface font-medium text-accent'
          : 'text-muted hover:text-ink'}"
        onclick={() => setView("edit")}
      >
        Edit
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "preview"}
        class="px-4 py-1.5 text-sm {view === 'preview'
          ? 'bg-surface font-medium text-accent'
          : 'text-muted hover:text-ink'}"
        onclick={() => setView("preview")}
      >
        Preview{#if compiled.warnings > 0}&nbsp;· {compiled.warnings}{/if}
      </button>
    </div>

    <div class={view === "preview" ? "hidden lg:contents" : "contents"}>
      <div
        class="flex overflow-hidden rounded-lg border border-line"
        role="tablist"
        aria-label="Editor mode"
      >
        {#each ["blocks", "markdown", "json"] as entry (entry)}
          <button
            type="button"
            role="tab"
            aria-selected={mode === entry}
            class="px-3 py-1.5 text-sm capitalize {mode === entry
              ? 'bg-surface font-medium text-accent'
              : 'text-muted hover:text-ink'}"
            onclick={() => changeMode(entry as "blocks" | "markdown" | "json")}
          >
            {entry}
          </button>
        {/each}
      </div>
      {#if mode === "blocks"}
        <button
          type="button"
          class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg hover:opacity-90"
          onclick={() => (paletteOpen = true)}
          title="Add block (Ctrl+K)"
        >
          + Add block
        </button>
      {:else}
        <span class="text-xs text-muted">Updates as you type</span>
      {/if}
    </div>

    <button
      type="button"
      class="rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-accent"
      onclick={reset}
    >
      Reset
    </button>

    <span class="ml-auto flex items-center gap-2 text-xs text-muted">
      {#if PDF_ENABLED}
        <button type="button" class="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-bg disabled:opacity-50" aria-busy={pdfBusy} disabled={pdfBusy || !health?.services?.pdf || !pdfTemplates.length} onclick={() => void exportPdf()}>{pdfBusy ? `Compiling… ${pdfElapsed}s` : "Export PDF"}</button>
        {#if pdfBusy}<button type="button" class="rounded-md border border-line px-3 py-1.5" onclick={() => pdfAbort?.abort()}>Cancel PDF</button>{/if}
        {#if health}
          <span class="rounded-full border border-line px-2 py-0.5">
            API {health.status}
            {health.services?.pdf ? " · PDF ready" : " · PDF pending"}
          </span>
        {:else}
          <span class="rounded-full border border-line px-2 py-0.5">
            API unreachable
          </span>
        {/if}
      {:else}
        <span
          class="rounded-full border border-line px-2 py-0.5"
          title="Set PUBLIC_API_URL + PUBLIC_PDF_ENABLED when the PDF service ships"
        >
          PDF export coming soon
        </span>
      {/if}
    </span>
  </div>

  {#if PDF_ENABLED}
    <details class="rounded-xl border border-line bg-surface p-3">
      <summary class="cursor-pointer text-sm font-medium">PDF options</summary>
      <div class="grid gap-3 pt-3 sm:grid-cols-2">
        <div class="grid min-w-0 gap-1.5 text-sm"><label for="pdf-template">PDF layout</label><select id="pdf-template" class="w-full min-w-0 rounded border border-line bg-bg p-2" bind:value={pdfTemplate} onchange={selectPdfTemplate} disabled={pdfBusy}>{#each pdfTemplates as template}<option value={template.id}>{template.label}</option>{/each}</select></div>
        <div class="grid min-w-0 gap-1.5 text-sm"><label for="pdf-engine">PDF engine</label><select id="pdf-engine" class="w-full min-w-0 rounded border border-line bg-bg p-2" bind:value={pdfEngine} disabled={pdfBusy}>{#each selectedPdfTemplate?.engines ?? [] as engine}<option value={engine}>{engineLabels[engine] ?? engine}</option>{/each}</select></div>
        <label class="grid min-w-0 gap-1.5 text-sm">Paper title<input class="w-full min-w-0 rounded border border-line bg-bg p-2" bind:value={pdfTitle} placeholder="Use document metadata" maxlength="500" /></label>
        <label class="grid min-w-0 gap-1.5 text-sm sm:col-span-2">Authors (separated by semicolons)<input class="w-full min-w-0 rounded border border-line bg-bg p-2" bind:value={pdfAuthors} placeholder="Use document metadata" maxlength="2000" /></label>
        <label class="grid min-w-0 gap-1.5 text-sm">Affiliation for entered authors<input class="w-full min-w-0 rounded border border-line bg-bg p-2" bind:value={pdfAffiliation} maxlength="500" /></label>
        {#if pdfTemplate === "acm-journal"}<label class="grid min-w-0 gap-1.5 text-sm">Affiliation country<input class="w-full min-w-0 rounded border border-line bg-bg p-2" bind:value={pdfCountry} maxlength="100" /></label>{/if}
      </div>
      <p class="pt-2 text-xs text-muted">The current document and its referenced public images are sent for compilation. Interactive blocks use readable fallbacks. Processing files are deleted after the request. Export time depends on the document and selected layout; you can cancel while it runs.</p>
    </details>
  {/if}

  {#if notice}
    <p
      class="rounded-lg border border-warning bg-surface px-3 py-2 text-sm"
      role="status"
    >
      {notice}
    </p>
  {/if}

  <details
    class="rounded-xl border border-line bg-surface p-3"
  >
    <summary class="cursor-pointer text-sm font-medium">Example documents · {playgroundExamples.length}</summary>
    <section
      aria-label="Example documents"
      class="pt-3"
    >
      <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {#each playgroundExamples as example (example.id)}
          <button
            type="button"
            class="rounded-lg border border-line bg-raised p-3 text-left transition hover:border-accent"
            onclick={() => loadExample(example)}
          >
            <span class="block text-sm font-medium">{example.title}</span>
            <span class="mt-0.5 block text-xs text-muted">
              {example.description}
            </span>
          </button>
        {/each}
      </div>
    </section>
  </details>

  <div class="grid min-w-0 gap-4 lg:grid-cols-2">
    <section
      aria-label="Document editor"
      class="min-w-0 max-h-[75vh] space-y-4 overflow-y-auto rounded-xl border border-line bg-surface p-3 sm:p-4 {view === 'preview' ? 'hidden lg:block' : ''}"
    >
      <h2 class="font-display text-lg font-semibold">Editor</h2>
      {#if mode === "blocks"}
        {#if blocks.length === 0}
          <p class="text-sm text-muted">
            No blocks. Press <kbd
              class="rounded border border-line bg-raised px-1 font-mono text-xs"
            >Ctrl+K</kbd
            > or use “Add block”.
          </p>
        {:else}
          {#each blocks as block (block.id)}
            {#if block.type === "publisle:math"}
              <MathBlockEditor
                {block}
                selected={selectedId === block.id}
                onSelect={(id) => (selectedId = id)}
                onUpdate={(id, data) => editor.updateBlock(id, data)}
              />
            {:else}
              <BlockEditor
                {block}
                selected={selectedId === block.id}
                onSelect={(id) => (selectedId = id)}
                onRemove={(id) => {
                  editor.removeBlock(id);
                  if (selectedId === id) selectedId = undefined;
                }}
                onMove={(id, direction) => editor.moveBlock(id, direction)}
                onDuplicate={(id) => duplicate(id)}
                onUpdate={(id, data) => editor.updateBlock(id, data)}
              />
            {/if}
          {/each}
        {/if}
      {:else if mode === "markdown"}
        <textarea
          class="min-h-[60vh] w-full rounded-lg border border-line bg-input p-3 font-mono text-xs"
          aria-label="Markdown source"
          spellcheck="false"
          bind:value={markdownText}
          oninput={scheduleSource}
        ></textarea>
      {:else}
        <textarea
          class="min-h-[60vh] w-full rounded-lg border border-line bg-input p-3 font-mono text-xs"
          aria-label="Document JSON"
          spellcheck="false"
          bind:value={jsonText}
          oninput={scheduleSource}
        ></textarea>
      {/if}
    </section>
    <section
      aria-label="Compiled preview"
      aria-busy={previewBusy}
      class="publication-wide min-w-0 max-h-[75vh] overflow-y-auto rounded-xl border border-line bg-surface p-3 sm:p-4 {view === 'edit' ? 'hidden lg:block' : ''}"
    >
      <h2 class="mb-2 font-display text-lg font-semibold">Live preview</h2>
      <p class="mb-3 text-xs text-muted">Your compiled article, with working interactive blocks.</p>
      {#if previewBusy}
        <p role="status" class="text-sm text-muted">Updating preview…</p>
      {:else if compiled.error}
        <p class="whitespace-pre-wrap rounded-lg border border-danger bg-surface px-3 py-2 font-mono text-xs">
          {compiled.error}
        </p>
      {:else}
        <div class="publisle-preview" bind:this={previewEl}>
          {#if previewTitle}<h2 class="mb-4 font-display text-2xl font-semibold">{previewTitle}</h2>{/if}
          {@html compiled.html}
        </div>
      {/if}
    </section>
  </div>

  <p class="text-xs text-muted" role="status">{storageAvailable ? "Draft saved automatically on this device." : "Browser storage unavailable. Copy your source to keep it."}</p>
  <p class="hidden text-xs text-muted sm:block">
    <kbd class="rounded border border-line bg-raised px-1 font-mono">Ctrl+K</kbd>
    add block ·
    <kbd class="rounded border border-line bg-raised px-1 font-mono">Ctrl+↵</kbd>
    toggle preview ·
    <kbd class="rounded border border-line bg-raised px-1 font-mono">Esc</kbd>
    back to editor
  </p>
</div>

<BlockPalette
  open={paletteOpen}
  categories={paletteCategories}
  oninsert={addBlock}
  onclose={() => (paletteOpen = false)}
/>

<script lang="ts">
  interface Props {
    storageKey: string;
    value: unknown;
    label: string;
    onApply: (parsed: unknown) => void;
  }
  let { storageKey, value, label, onApply }: Props = $props();
  let text = $state("");
  let error = $state<string | undefined>(undefined);
  $effect(() => {
    text = JSON.stringify(value, null, 2);
    error = undefined;
  });
  function apply(): void {
    try {
      onApply(JSON.parse(text) as unknown);
      error = undefined;
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "Invalid JSON.";
    }
  }
</script>

<div class="json-field">
  <textarea
    rows="6"
    aria-label={label}
    spellcheck="false"
    bind:value={text}
  ></textarea>
  {#if error}
    <p class="muted" role="alert">{error}</p>
  {/if}
  <button type="button" onclick={apply}>Apply JSON</button>
</div>

<script lang="ts">
  // Decorative miniature of a compiled block. The markup is static and
  // author-controlled (never compiled from user content) and uses the same
  // publication classes as the article, so it looks like the real thing.
  interface Props {
    type: string;
    /** Used only for block types without a built-in sample (host extensions). */
    label?: string;
    size?: "sm" | "lg";
  }

  let { type, label = "", size = "sm" }: Props = $props();
</script>

<!-- `publisle-preview` keeps the site's copy-code script away from the sample. -->
<div
  class="block-sample publisle-document publisle-preview"
  class:block-sample--lg={size === "lg"}
  aria-hidden="true"
>
  {#if type === "publisle:paragraph"}
    <p>A short sentence that opens an idea.</p>
  {:else if type === "publisle:heading"}
    <h2>Section heading</h2>
  {:else if type === "publisle:list"}
    <ul>
      <li>First item</li>
      <li>Second item</li>
    </ul>
  {:else if type === "publisle:quote"}
    <blockquote><p>Worth quoting.</p></blockquote>
  {:else if type === "publisle:callout"}
    <aside class="publisle-callout publisle-callout-info">
      <strong>Note</strong>
      <p>Readers should see this</p>
    </aside>
  {:else if type === "publisle:code"}
    <pre><code>const total = 1 + 2;</code></pre>
  {:else if type === "publisle:math"}
    <p class="publisle-math block-sample__math"><i>x</i><sup>2</sup> + <i>y</i><sup>2</sup> = <i>z</i><sup>2</sup></p>
  {:else if type === "publisle:figure"}
    <figure>
      <p class="publisle-figure-placeholder">Image</p>
      <figcaption>Figure 1. Caption</figcaption>
    </figure>
  {:else if type === "publisle:table"}
    <table>
      <thead><tr><th>Name</th><th>Value</th></tr></thead>
      <tbody><tr><td>A</td><td>1</td></tr></tbody>
    </table>
  {:else if type === "publisle:diagram"}
    <figure>
      <svg viewBox="0 0 120 40" role="presentation" focusable="false">
        <rect x="4" y="10" width="34" height="20" rx="4" fill="none" stroke="currentColor" stroke-width="2" />
        <rect x="82" y="10" width="34" height="20" rx="4" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M38 20h38m-6-5 6 5-6 5" fill="none" stroke="currentColor" stroke-width="2" />
      </svg>
      <figcaption>A leads to B</figcaption>
    </figure>
  {:else if type === "publisle:embed"}
    <figure>
      <p class="publisle-figure-placeholder">▶ Video</p>
      <figcaption>Embedded media</figcaption>
    </figure>
  {:else if type === "publisle:bibliography"}
    <h2>References</h2>
    <ol>
      <li>Author, A. <em>An Example Reference</em>. 2026.</li>
    </ol>
  {:else if type === "publisle:divider"}
    <p>Above the line</p>
    <hr />
    <p>Below the line</p>
  {:else if type === "publisle:raw-html"}
    <pre><code>{'<div class="note">…</div>'}</code></pre>
  {:else if type === "publisle:interactive-schematic"}
    <figure>
      <svg viewBox="0 0 120 40" role="presentation" focusable="false">
        <path d="M2 14h24M2 26h24M62 20h30" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M26 6v28l36-14z" fill="none" stroke="currentColor" stroke-width="2" />
        <circle cx="96" cy="20" r="4" fill="none" stroke="currentColor" stroke-width="2" />
      </svg>
      <figcaption>Interactive schematic</figcaption>
    </figure>
  {:else}
    <p>{label || type}</p>
  {/if}
</div>

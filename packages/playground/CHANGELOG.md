# @publisle/playground

## 0.2.4

### Patch Changes

- 751ff01: Suppress empty references and automatic LaTeX dates, keep tables before references,
  and preserve native diagnostics when PDF export retries with LuaLaTeX. Load Markdown
  and math support on demand in the playground, label PDF engines, and default the
  site to dark while preserving saved theme preferences.

## 0.2.3

### Patch Changes

- ebe4478: Repository moved to the publisle GitHub org
- Updated dependencies [ebe4478]
  - @publisle/blocks-core@0.1.3
  - @publisle/core@0.1.3
  - @publisle/markdown@0.1.3
  - @publisle/schema@0.1.2

## 0.2.2

### Patch Changes

- a9d627b: Add npm keywords to every package manifest. The Astro adapter now carries the `astro-integration`, `astro-component` and `withastro` keywords so it appears in the Astro integrations directory.
- Updated dependencies [a9d627b]
  - @publisle/core@0.1.2
  - @publisle/markdown@0.1.2
  - @publisle/schema@0.1.1

## 0.2.1

### Patch Changes

- c984751: Use labeled multiline fields for inline segments and update the document as their text is edited.

## 0.2.0

### Minor Changes

- 69132ae: New package promoted from the example hosts: `DocumentEditor` over the portable
  document schema with an injectable block registry, declarative field specs for
  every core block, and Svelte 5 `BlockEditor`/`JsonField` components. Hosts
  extend the block palette through `PlaygroundExtensions` (labels, default data,
  field specs, registry definitions) instead of forking the editor.
- 2ddf71a: Playground editor upgrades: `duplicateBlock` on `DocumentEditor` (deep clone,
  fresh id), block palette metadata (`CORE_BLOCK_DESCRIPTIONS`,
  `CORE_BLOCK_CATEGORIES`, `blockDescriptions`, `blockCategories`, and optional
  `description`/`category` on `PlaygroundBlockExtension`), and a math editing
  toolkit — searchable symbol-palette data, pure `insertMathSnippet` insertion
  with selection wrapping and caret placement, `tokenizeMath`/`highlightMath`
  for syntax-highlight overlays, and `MathEditor`/`MathBlockEditor` Svelte
  components with live KaTeX preview. `BlockEditor` gains a selection ring,
  duplicate action, per-kind segment tint chips, and inline math segments that
  expand into a compact math editor. Palette labels are glyphs (α, ∑, ⎧⎨⎩) and
  `□` argument guides render as `\square` in the preview instead of erroring.

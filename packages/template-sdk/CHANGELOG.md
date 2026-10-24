# @publisle/template-sdk

## 0.1.5

### Patch Changes

- 751ff01: Suppress empty references and automatic LaTeX dates, keep tables before references,
  and preserve native diagnostics when PDF export retries with LuaLaTeX. Load Markdown
  and math support on demand in the playground, label PDF engines, and default the
  site to dark while preserving saved theme preferences.

## 0.1.4

### Patch Changes

- ebe4478: Repository moved to the publisle GitHub org
- Updated dependencies [ebe4478]
  - @publisle/schema@0.1.2

## 0.1.3

### Patch Changes

- 0c8ad7b: Add an explicit experimental Rust PDF compiler API and CLI engine with pinned fonts, bounded math, local assets and structured diagnostics. Allow editor hosts to supply resolved citation and bibliography text without loading CSL in publication readers. Omit empty abstracts and normalize body section levels in LaTeX exports.
- a9d627b: Add npm keywords to every package manifest. The Astro adapter now carries the `astro-integration`, `astro-component` and `withastro` keywords so it appears in the Astro integrations directory.
- 603d12a: Load named math colors only for documents that use color commands, allowing the Fourier sample's colored equations to survive PDF export.

  Skip bilingual setup for LuaLaTeX documents without Arabic content, while retaining Arabic shaping when it is needed.

- f3dd162: Preview and export fidelity fixes. LaTeX export reduces embeds, diagrams and raw HTML to one readable text instead of concatenating the alternative text with the authored fallback. Publication artifacts number footnote markers and definitions by first reference instead of showing raw labels, and style the numbers. LuaLaTeX section levels are relative to the first emitted heading, so documents whose title doubles as a level-1 heading no longer number sections 0.1 onward. The website shortens four documentation titles below 60 characters.
- Updated dependencies [a9d627b]
  - @publisle/schema@0.1.1

## 0.1.2

### Patch Changes

- 4342a8d: Reject control-obfuscated executable URLs, preserve HTML attributes during placement,
  finish all island cleanups after host errors, and retry failed visible activation
  on viewport re-entry. Omit empty publisher BibTeX bibliographies so documents without
  references compile successfully.

  Load Arabic and CJK shaping fonts only when the article uses those scripts,
  reducing research compilation memory without changing text or tagging behavior.

## 0.1.1

### Patch Changes

- e97d4d7: Allow compatible updates between independently versioned Publisle packages. Require Astro 7.2.8 or newer in the Astro adapter to resolve the reported security advisories. Astro 6 is no longer supported.

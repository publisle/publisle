# @publisle/research

## 0.3.4

### Patch Changes

- bded885: Pin the optional `@publisle/pdf-native-*` platform packages to 0.5.0, which
  follows publisle-pdf 0.5.0: opt-out build features (`raster`, `svg`,
  `pdf-import`, `cli`) with unchanged default behaviour for the hosted worker.
  The VPS native runtime pin moves to the same version.

## 0.3.3

### Patch Changes

- cf145f8: Pin the optional `@publisle/pdf-native-*` platform packages to 0.4.0, which carries
  the native math fixes from publisle/publisle-rs#25: bounded support for common TeX
  commands (`\hat`, `\binom`, accents, `\overset`/`\underset`, `\boxed`, `\tag`),
  italic variables, operator spacing, display-style limits, stretched fences, LaTeX-
  matching equation numbering, and visible warnings instead of aborted exports for
  unknown commands. The VPS native runtime pin moves to the same version.

## 0.3.2

### Patch Changes

- 751ff01: Suppress empty references and automatic LaTeX dates, keep tables before references,
  and preserve native diagnostics when PDF export retries with LuaLaTeX. Load Markdown
  and math support on demand in the playground, label PDF engines, and default the
  site to dark while preserving saved theme preferences.
- Updated dependencies [751ff01]
  - @publisle/template-sdk@0.1.5

## 0.3.1

### Patch Changes

- ebe4478: Use the independently versioned native PDF binaries published from publisle/publisle-rs.
- ebe4478: Repository moved to the publisle GitHub org
- Updated dependencies [ebe4478]
  - @publisle/contracts@0.1.3
  - @publisle/profiles@0.1.3
  - @publisle/schema@0.1.2
  - @publisle/template-article@0.1.3
  - @publisle/template-sdk@0.1.4

## 0.3.0

### Minor Changes

- 628aa6a: Install the matching optional native compiler and fonts on supported platforms. Keep native PDF opt-in and preserve each hosted profile’s legacy default. Release native binaries in lockstep with Research using validated archives and trusted publishing.

### Patch Changes

- Allow up to one minute for a cold container compiler probe to initialize before declaring the installed compiler unavailable.

## 0.2.0

### Minor Changes

- 0c8ad7b: Add an explicit experimental Rust PDF compiler API and CLI engine with pinned fonts, bounded math, local assets and structured diagnostics. Allow editor hosts to supply resolved citation and bibliography text without loading CSL in publication readers. Omit empty abstracts and normalize body section levels in LaTeX exports.

### Patch Changes

- a9d627b: Add npm keywords to every package manifest. The Astro adapter now carries the `astro-integration`, `astro-component` and `withastro` keywords so it appears in the Astro integrations directory.
- f3dd162: Preview and export fidelity fixes. LaTeX export reduces embeds, diagrams and raw HTML to one readable text instead of concatenating the alternative text with the authored fallback. Publication artifacts number footnote markers and definitions by first reference instead of showing raw labels, and style the numbers. LuaLaTeX section levels are relative to the first emitted heading, so documents whose title doubles as a level-1 heading no longer number sections 0.1 onward. The website shortens four documentation titles below 60 characters.
- Updated dependencies [0c8ad7b]
- Updated dependencies [a9d627b]
- Updated dependencies [603d12a]
- Updated dependencies [f3dd162]
  - @publisle/template-sdk@0.1.3
  - @publisle/contracts@0.1.2
  - @publisle/profiles@0.1.2
  - @publisle/schema@0.1.1
  - @publisle/template-article@0.1.2

## 0.1.1

### Patch Changes

- e97d4d7: Allow compatible updates between independently versioned Publisle packages. Require Astro 7.2.8 or newer in the Astro adapter to resolve the reported security advisories. Astro 6 is no longer supported.
- Updated dependencies [e97d4d7]
  - @publisle/contracts@0.1.1
  - @publisle/profiles@0.1.1
  - @publisle/template-article@0.1.1
  - @publisle/template-sdk@0.1.1

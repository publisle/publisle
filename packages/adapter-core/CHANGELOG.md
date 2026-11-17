# @publisle/adapter-core

## 0.2.4

### Patch Changes

- d405ca1: Name each code block's language and highlight the common ones, including
  JavaScript, TypeScript, Python, JSON, HTML, CSS, Bash, Rust, Go, Java, C,
  C++, SQL, and YAML.
- e5b1762: Keep an empty figure as a placeholder instead of failing the document, and
  render a warning in place of an unsafe figure URL. The playground edits list
  items, links, and images as fields so inline math and task state stay put.
- Updated dependencies [e5b1762]
  - @publisle/core@0.1.4

## 0.2.3

### Patch Changes

- 03559f1: Update KaTeX from 0.16.47 to 0.19.0. The rendered CSS is re-exported from the
  installed package, so the 0.18 internal class prefixing (`katex-` prefixed
  selectors) applies automatically; no publisle selector targeted the old class
  names, and the playground math editor already renders with `strict: "ignore"`,
  which preserves the previous behaviour for missing character metrics.

## 0.2.2

### Patch Changes

- 751ff01: Suppress empty references and automatic LaTeX dates, keep tables before references,
  and preserve native diagnostics when PDF export retries with LuaLaTeX. Load Markdown
  and math support on demand in the playground, label PDF engines, and default the
  site to dark while preserving saved theme preferences.

## 0.2.1

### Patch Changes

- ebe4478: Repository moved to the publisle GitHub org
- Updated dependencies [ebe4478]
  - @publisle/core@0.1.3
  - @publisle/markdown@0.1.3
  - @publisle/schema@0.1.2

## 0.2.0

### Minor Changes

- 0c8ad7b: Add an explicit experimental Rust PDF compiler API and CLI engine with pinned fonts, bounded math, local assets and structured diagnostics. Allow editor hosts to supply resolved citation and bibliography text without loading CSL in publication readers. Omit empty abstracts and normalize body section levels in LaTeX exports.

### Patch Changes

- a9d627b: Add npm keywords to every package manifest. The Astro adapter now carries the `astro-integration`, `astro-component` and `withastro` keywords so it appears in the Astro integrations directory.
- f3dd162: Preview and export fidelity fixes. LaTeX export reduces embeds, diagrams and raw HTML to one readable text instead of concatenating the alternative text with the authored fallback. Publication artifacts number footnote markers and definitions by first reference instead of showing raw labels, and style the numbers. LuaLaTeX section levels are relative to the first emitted heading, so documents whose title doubles as a level-1 heading no longer number sections 0.1 onward. The website shortens four documentation titles below 60 characters.
- 603d12a: Avoid duplicated authored cross-reference labels, align equation numbers beside display math, and contain long equations and code blocks within their article.
- Updated dependencies [a9d627b]
  - @publisle/core@0.1.2
  - @publisle/markdown@0.1.2
  - @publisle/schema@0.1.1

## 0.1.2

### Patch Changes

- 879eed3: Move `vite` from dependencies to an optional peer dependency. Only the optional `./vite` plugin entry imports it, so a core install now skips the entire Vite toolchain; hosts using the plugin already have Vite in their build.
- 4342a8d: Reject control-obfuscated executable URLs, preserve HTML attributes during placement,
  finish all island cleanups after host errors, and retry failed visible activation
  on viewport re-entry. Omit empty publisher BibTeX bibliographies so documents without
  references compile successfully.

  Load Arabic and CJK shaping fonts only when the article uses those scripts,
  reducing research compilation memory without changing text or tagging behavior.

## 0.1.1

### Patch Changes

- e97d4d7: Allow compatible updates between independently versioned Publisle packages. Require Astro 7.2.8 or newer in the Astro adapter to resolve the reported security advisories. Astro 6 is no longer supported.
- Updated dependencies [e97d4d7]
  - @publisle/core@0.1.1
  - @publisle/markdown@0.1.1

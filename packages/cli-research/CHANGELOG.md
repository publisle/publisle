# @publisle/cli-research

## 0.2.3

### Patch Changes

- Updated dependencies [a68e305]
- Updated dependencies [fb368b4]
- Updated dependencies [c7a24b2]
- Updated dependencies [6793503]
  - @publisle/research@0.4.0
  - @publisle/template-sdk@0.1.6
  - @publisle/cli@0.3.0

## 0.2.2

### Patch Changes

- ebe4478: Repository moved to the publisle GitHub org
- Updated dependencies [ebe4478]
- Updated dependencies [ebe4478]
  - @publisle/research@0.3.1
  - @publisle/adapter-core@0.2.1
  - @publisle/cli@0.2.2
  - @publisle/core@0.1.3
  - @publisle/markdown@0.1.3
  - @publisle/schema@0.1.2
  - @publisle/template-acm@0.1.3
  - @publisle/template-article@0.1.3
  - @publisle/template-elsevier@0.1.3
  - @publisle/template-ieee@0.1.3
  - @publisle/template-sdk@0.1.4
  - @publisle/template-springer@0.1.3

## 0.2.1

### Patch Changes

- Updated dependencies [628aa6a]
  - @publisle/research@0.3.0
  - @publisle/cli@0.2.1

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
- Updated dependencies [603d12a]
  - @publisle/research@0.2.0
  - @publisle/adapter-core@0.2.0
  - @publisle/template-sdk@0.1.3
  - @publisle/template-acm@0.1.2
  - @publisle/template-springer@0.1.2
  - @publisle/template-elsevier@0.1.2
  - @publisle/cli@0.2.1
  - @publisle/core@0.1.2
  - @publisle/markdown@0.1.2
  - @publisle/schema@0.1.1
  - @publisle/template-article@0.1.2
  - @publisle/template-ieee@0.1.2

## 0.1.2

### Patch Changes

- 879eed3: Publish the CLI peer dependency as a compatible caret range, including the new CLI build release.
- Updated dependencies [879eed3]
- Updated dependencies [879eed3]
- Updated dependencies [4342a8d]
  - @publisle/adapter-core@0.1.2
  - @publisle/cli@0.2.0
  - @publisle/template-sdk@0.1.2

## 0.1.1

### Patch Changes

- e97d4d7: Allow compatible updates between independently versioned Publisle packages. Require Astro 7.2.8 or newer in the Astro adapter to resolve the reported security advisories. Astro 6 is no longer supported.
- Updated dependencies [e97d4d7]
  - @publisle/adapter-core@0.1.1
  - @publisle/cli@0.1.1
  - @publisle/core@0.1.1
  - @publisle/markdown@0.1.1
  - @publisle/research@0.1.1
  - @publisle/template-acm@0.1.1
  - @publisle/template-article@0.1.1
  - @publisle/template-elsevier@0.1.1
  - @publisle/template-ieee@0.1.1
  - @publisle/template-sdk@0.1.1
  - @publisle/template-springer@0.1.1

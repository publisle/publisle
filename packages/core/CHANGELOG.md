# @publisle/core

## 0.1.5

### Patch Changes

- cc53b8b: Reuse validated traversal declarations during document preparation to speed up validation and rendering of large documents.
- Updated dependencies [cc53b8b]
  - @publisle/schema@0.1.3

## 0.1.4

### Patch Changes

- e5b1762: Keep an empty figure as a placeholder instead of failing the document, and
  render a warning in place of an unsafe figure URL. The playground edits list
  items, links, and images as fields so inline math and task state stay put.

## 0.1.3

### Patch Changes

- ebe4478: Repository moved to the publisle GitHub org
- Updated dependencies [ebe4478]
  - @publisle/schema@0.1.2

## 0.1.2

### Patch Changes

- a9d627b: Add npm keywords to every package manifest. The Astro adapter now carries the `astro-integration`, `astro-component` and `withastro` keywords so it appears in the Astro integrations directory.
- Updated dependencies [a9d627b]
  - @publisle/schema@0.1.1

## 0.1.1

### Patch Changes

- e97d4d7: Allow compatible updates between independently versioned Publisle packages. Require Astro 7.2.8 or newer in the Astro adapter to resolve the reported security advisories. Astro 6 is no longer supported.

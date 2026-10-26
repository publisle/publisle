# @publisle/contracts

## 0.2.0

### Minor Changes

- 5a07a24: Preserve volume, issue, pages, publisher, edition, DOI and URL in the built-in
  numeric and author-date bibliographies. Carry optional edition values through
  bibliography validation, article projection, BibTeX and CSL-JSON so native PDF
  exports receive the full resolved reference text.

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

# @publisle/blocks-core

## 0.2.0

### Minor Changes

- 5a07a24: Preserve volume, issue, pages, publisher, edition, DOI and URL in the built-in
  numeric and author-date bibliographies. Carry optional edition values through
  bibliography validation, article projection, BibTeX and CSL-JSON so native PDF
  exports receive the full resolved reference text.

### Patch Changes

- Updated dependencies [5a07a24]
  - @publisle/contracts@0.2.0
  - @publisle/block-sdk@0.1.4

## 0.1.3

### Patch Changes

- ebe4478: Repository moved to the publisle GitHub org
- Updated dependencies [ebe4478]
  - @publisle/block-sdk@0.1.3
  - @publisle/contracts@0.1.3
  - @publisle/schema@0.1.2

## 0.1.2

### Patch Changes

- 628aa6a: Install the matching optional native compiler and fonts on supported platforms. Keep native PDF opt-in and preserve each hosted profile’s legacy default. Release native binaries in lockstep with Research using validated archives and trusted publishing.

## 0.1.1

### Patch Changes

- e97d4d7: Allow compatible updates between independently versioned Publisle packages. Require Astro 7.2.8 or newer in the Astro adapter to resolve the reported security advisories. Astro 6 is no longer supported.
- Updated dependencies [e97d4d7]
  - @publisle/block-sdk@0.1.1
  - @publisle/contracts@0.1.1

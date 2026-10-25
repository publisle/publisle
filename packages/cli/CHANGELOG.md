# @publisle/cli

## 0.3.0

### Minor Changes

- fb368b4: `publisle build --watch` keeps running and rebuilds when the source or
  host config changes, debouncing by 150 ms. Watch rebuilds stage a sibling
  output directory and rename it over the previous output, so readers never
  see a partial build. Requires an embedding host that supplies a
  cancellation signal.
- 6793503: `publisle validate` accepts `--diagnostics json`, printing the structured
  diagnostics as `{"diagnostics":[...],"valid":boolean}` on stdout with
  unchanged exit codes, for CI pipelines and editors. The human text output
  stays the default and remains on stderr.

## 0.2.2

### Patch Changes

- ebe4478: Repository moved to the publisle GitHub org
- Updated dependencies [ebe4478]
  - @publisle/adapter-core@0.2.1
  - @publisle/blocks-core@0.1.3
  - @publisle/contracts@0.1.3
  - @publisle/core@0.1.3
  - @publisle/markdown@0.1.3
  - @publisle/schema@0.1.2

## 0.2.1

### Patch Changes

- a9d627b: Add npm keywords to every package manifest. The Astro adapter now carries the `astro-integration`, `astro-component` and `withastro` keywords so it appears in the Astro integrations directory.
- Updated dependencies [0c8ad7b]
- Updated dependencies [a9d627b]
- Updated dependencies [f3dd162]
- Updated dependencies [603d12a]
  - @publisle/adapter-core@0.2.0
  - @publisle/contracts@0.1.2
  - @publisle/core@0.1.2
  - @publisle/markdown@0.1.2
  - @publisle/schema@0.1.1

## 0.2.0

### Minor Changes

- 879eed3: Add the `publisle build <file.json|file.md> --out <new-directory>` command: it compiles a portable document into a static reader page (HTML, stylesheets with inlined KaTeX rules, and a `publication.json` island manifest). Interactive blocks ship their authored fallbacks. The CLI now depends on `@publisle/adapter-core`; research tooling stays optional.

### Patch Changes

- Updated dependencies [879eed3]
- Updated dependencies [4342a8d]
  - @publisle/adapter-core@0.1.2

## 0.1.1

### Patch Changes

- e97d4d7: Allow compatible updates between independently versioned Publisle packages. Require Astro 7.2.8 or newer in the Astro adapter to resolve the reported security advisories. Astro 6 is no longer supported.
- Updated dependencies [e97d4d7]
  - @publisle/blocks-core@0.1.1
  - @publisle/contracts@0.1.1
  - @publisle/core@0.1.1
  - @publisle/markdown@0.1.1

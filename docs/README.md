# Publisle documentation

Start with **Core** to author, validate, prepare and publish semantic documents.
Core requires no citeproc, TeX, xmllint, Docker or Research template packages.
The optional **Research profile** adds scholarly preparation, citations, journal
sources and PDF/JATS export.

| Entry point                                                                     | Purpose                                                                            |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Project overview and Core quickstart](../README.md#core-in-process-quickstart) | Small prepared article and supported integration paths                             |
| [Normative standards index](standards/README.md)                                | Core contracts, named profiles and machine-readable sources                        |
| [Research profile 1 (beta)](standards/publishing.md)                            | Optional citations, templates, export and compiler contracts                       |
| [Conformance claims and evidence](standards/conformance.md)                     | Roles, TEST-01–16 scope, executable gates and explicit unclaimed limits            |
| [Governance and versioning](governance.md)                                      | Beta freeze, immutable digests, compatibility matrix and change/deprecation policy |
| [Developer guide](developer-guide.md)                                           | Public APIs, framework adapters, profiles, resources and migrations                |

## Guides

| Guide                                                        | Use it for                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------- |
| [Framework hosts](guides/framework-hosts.md)                 | React, Svelte, Next.js, Astro and Vue integration                           |
| [MCP server](guides/mcp.md)                                  | Let AI assistants draft, edit, preview and export documents                 |
| [Contracts](guides/contracts.md)                             | Exported schemas, sealed contracts and offline validation                   |
| [Meaning](guides/meaning.md)                                 | Inspecting declarations without executing plugins                           |
| [Exchange](guides/exchange.md)                               | Immutable pins, archival Markdown and offline asset packages                |
| [Accessibility](guides/accessibility.md)                     | Core inspection v2, output requirements and PDF validation scope            |
| [Pinned reproductions and feedback](guides/reproductions.md) | Exact versions, packed consumer replay and useful issue evidence            |
| [Standalone Fourier showcase](../showcase/fourier/README.md) | Full-article packed Core/Astro rehearsal; public release/deployment pending |
| [Release and distribution](guides/releases.md)               | ESM/declaration builds, packed-consumer checks and release acceptance       |
| [Journal export](guides/journal-export.md)                   | Research CLI, template selection, engine tiers and submission packages      |
| [Independent Python consumer](../tools/python/README.md)     | Offline validation, static rendering, bounded citations and declared limits |

## Verification and project status

[Required CI](../.github/workflows/check.yml) runs `pnpm check`,
`pnpm test:conformance:renderer` and `pnpm test:conformance:p0`. The
[renderer gate](../tools/renderer-gate.ts) compares independent static, MathML,
migration, fallback/refusal and bounded citation outcomes. The
[P0 gate](../tools/p0-gate.ts) requires fresh passing evidence for TEST-01–13,
including actual Chromium runs. Missing or skipped evidence fails these gates.

The [Research workflow](../.github/workflows/research.yml) separately exercises
compiler/export fixtures and the PDF/UA validation gate. The
[Research evidence record](standards/conformance.md#research-artifact-evidence)
records locally verified English/Arabic UA-2 and English UA-1 fixtures and
their limits. A configured job or
requested PDF standard is not a passing artifact report. The
[conformance matrix](standards/conformance.md#claim-and-evidence-matrix) records
which scope each result can support. Local
[performance measurements](standards/performance.md) and
[budget snapshots](standards/performance-budgets.md) are observations rather than
required CI timing budgets.

`pnpm test:distribution` builds and packs the 23-package publish set, checks
packed entry points/types and proves the Core-only dependency/CLI boundary in a
clean consumer. This is package readiness evidence, not registry publication.
See the [release guide](guides/releases.md).

The [release guide](guides/releases.md) tracks remaining release,
registry and outside-consumer work. Documentation describes implemented contracts
without asserting that package publication, multi-architecture image validation
or public adoption has already happened.

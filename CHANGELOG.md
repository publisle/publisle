# Changelog

## Unreleased

- Let pdfLaTeX hyphenate the first word of a table cell, so a long dictionary
  word no longer paints over the next column.

## 2026-11-03

- Omit an empty LuaLaTeX table caption, so a Markdown table no longer prints
  "Table 1:". Tables with six or more columns stay inside the measure in a
  smaller font, instead of running past the page.
- Name the character LuaLaTeX cannot render, and draw emoji from monochrome
  Noto Emoji on LuaLaTeX.
- Defer the playground math editor, symbol palette, schematic island, and
  article preview until they are on screen, so a phone does not compile the
  preview during the first paint.
- Give playground block options and PDF options room for their labels, so
  checkboxes, inline math, and JSON fields no longer collide with their text.
- Require Astro 7.2.8 or newer within Astro 7 in the Astro adapter and example,
  resolving the reported Astro advisories and dropping Astro 6 support.
- Prepare independently versioned npm releases with Changesets and compatible
  internal dependency ranges. KaTeX remediation remains deferred.

## 0.1.0 — 2026-10-10

All 23 public packages use `0.1.0` for the first beta release, published under
the npm `beta` tag. Contract version integers and npm versions are separate
identifiers.

Contract versions at the first release, frozen and independent of the npm
version: document envelope **1**, publication artifact **1**, block payloads
**1**, schematic **2**, accessibility inspection **2**, and the Research profile
at **1** (beta). Schematic 2 is the first published wire shape: version 1
predates publication, and pre-publication version-1 payloads reach adopters only
through the declared v1→2 migration. These integers are never renumbered to
match a release.

- Separate Core packages and CLI from optional Research tooling.
- Add ESM JavaScript, declarations, source maps and packed consumer validation for
  all 23 packages.
- Add independent renderer/citation conformance and PDF accessibility validation.
- Prepare the coordinated `0.1.0` beta package set and versioned showcase rehearsal.
- Retain dependency-derived publication order, tarball hashes and installed Core
  contract digests in the distribution release manifest.
- Generate the showcase lock in a clean temporary directory and replay it with
  `npm ci`, preserving integrity metadata when a previous installation exists.

Compatibility: this is the first package release, with Core and Research profile
boundaries described above. Node.js ≥24 is required. Research remains optional.

Compiler recipe **2**, release **recipe-2.0.0**:

- Multi-architecture image: `ghcr.io/voidreg/publisle-compiler@sha256:224d31b5294c99d0e03ec5507b2f9430f29ee97cc2dc37713c9b7ddde163b802`.
- linux/amd64: `sha256:f58408dc50f581d56aba65e30d51151e972e50bc3d9b6ab24e6d15a2dd856db7`.
- linux/arm64: `sha256:f112851ed6d678de32a29b48b28e5f5b18af1d19ecd08b21c8dd0c92bde6770f`.
- veraPDF **1.28.2**, installer SHA-256
  `d1693a5f0bf0997180f6d97e8a5568b0cf39e27eee338d439c8adb58435c1e89`.

Both architectures passed native publisher compilation and all three PDF/UA
fixtures before publication. Evidence: [compiler release and native fixture
reports](https://github.com/publisle/publisle/actions/runs/38083600968),
[Core checks and conformance](https://github.com/publisle/publisle/actions/runs/38083105036),
[Research export](https://github.com/publisle/publisle/actions/runs/38083105023),
and [packed distribution and showcase](https://github.com/publisle/publisle/actions/runs/38083105089).

The [release artifacts](https://github.com/publisle/publisle/releases/tag/v0.1.0)
retain the exact tarballs, publication-order/hash manifest, and offline built-in
contract bundle with all 16 shipped contract identities and digest seals.
Registry installation checks and public showcase deployment are recorded
separately; a package release does not establish adoption.

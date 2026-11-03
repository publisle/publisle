# Local research export and template packages

Part of the **Publisle Research profile** ([publishing](../standards/publishing.md)). These commands require the optional `@publisle/cli-research` plugin; the Core CLI prints install guidance when it is absent. Core adopters publish through [native adapters or publication artifacts](../../README.md) with no TeX dependency.

PDF export defaults to the Unicode article template and LuaLaTeX, requesting PDF/UA-2 tagging with a modern compiler. See the [accessibility guide](accessibility.md) for compiler requirements, validation, and explicit untagged publisher-template diagnostics. It never falls
back to Helvetica. The deprecated synchronous `toPdf` API remains available for
migration and rejects unencodable characters unless `{ allowLossy: true }` is
explicitly supplied. New Node callers should use `exportPdf`.

Install the CLI and Research plugin with Node.js 24 or later:

```sh
npm install -g @publisle/cli @publisle/cli-research
```

The examples below use files from a [repository checkout](../../CONTRIBUTING.md).
For your own document, replace the example path with your Markdown file.

```sh
publisle doctor
publisle export examples/articles/ieee-unicode.md --to pdf --output /tmp/article.pdf
publisle export examples/articles/ieee-journal.md --to submission \
  --template ieee-journal --output /tmp/ieee-source
publisle export examples/articles/ieee-journal.md --to submission \
  --template springer-journal --archive --output /tmp/springer-source.zip
publisle export examples/articles/ieee-journal.md --to jats-submission \
  --archive --output /tmp/article-jats.zip
```

Outputs refuse existing destinations. A LaTeX submission includes source,
bibliography, local figures, PDF, build instructions, logs, and a manifest recording
template version, requirements, backend, engine/font versions and diagnostics.
JATS packages collect article XML and figures and validate against the bundled
Archiving 1.3 DTD using `xmllint --nonet`. `toJats` remains a single-article API.
ZIP archives contain the same package files as directory exports.

## From the playground to a journal PDF

A research paper is ordinary Markdown, so the same document can be authored in
either playground and exported to any journal theme. Open a playground, choose
**Load research paper** (the [interactive export
study](../../examples/articles/interactive-research-paper.md)), edit it, and use
**Export Markdown**. The saved file feeds the CLI unchanged:

```sh
publisle export paper.md --to html \
  --config examples/articles/interactive-paper.host.ts \
  --output paper-preview.html
publisle export paper.md --to pdf --template ieee-journal \
  --output paper-ieee.pdf
publisle export paper.md --to pdf --template acm-journal \
  --template-data country.json --output paper-acm.pdf
```

The same file exports through `elsevier-numeric` and `springer-journal` with no
other changes; only the template flag moves. `pnpm demo:paper` runs the whole
sweep on the bundled paper into `.local/demos/`.

Three boundary facts to keep straight while reviewing:

- The web preview renders the authored body blocks; a research paper's title
  lives in the front matter and is typeset by the journal template, so the
  preview begins at the abstract. Interactive islands are live in the web
  edition.
- Print and PDF exports never execute interactive behavior. Diagrams and embeds
  contribute their accessible text, schematic islands contribute their authored
  fallback prose, and each reduction is reported as
  `research-block-reduced` or `research-block-fallback` in the export
  diagnostics. An export that omits a fallback silently is broken, not terse.
- The zero-TeX HTML preview prepares the document through the Core artifact
  path, so it needs the demo's [host
  config](../../examples/articles/interactive-paper.host.ts) to register the
  schematic island. Journal exports do not need it. Publisher themes are the
  untagged native tier (`pdf-ua-unavailable` diagnostic); PDF/UA-tagged output
  remains the standard article template's LuaLaTeX path
  ([accessibility](accessibility.md)).

## Public templates

`@publisle/template-sdk` exports projected article types, escaping helpers,
`PublishingTemplate`, `TemplateContext`, and source-package contracts. Templates
validate metadata and render pure source packages. They are trusted host code;
callbacks are not a portable wire standard and do not acquire compiler/filesystem
privileges through this interface. The research package orchestrates templates;
publisher rules live in separate packages.

| Package             | Template ID            | Profile / default engine                          |
| ------------------- | ---------------------- | ------------------------------------------------- |
| `template-article`  | `article`              | Generic CSL article / LuaLaTeX                    |
| `template-article`  | `article-arabic`       | Arabic main language and RTL flow / LuaLaTeX      |
| `template-ieee`     | `ieee-journal`         | IEEEtran journal, numeric bibliography / pdfLaTeX |
| `template-acm`      | `acm-journal`          | acmart manuscript review / pdfLaTeX               |
| `template-elsevier` | `elsevier-numeric`     | elsarticle review, numeric / pdfLaTeX             |
| `template-elsevier` | `elsevier-author-date` | elsarticle review, author-year / pdfLaTeX         |
| `template-springer` | `springer-journal`     | sn-jnl math/physics numeric / pdfLaTeX            |

These are representative starter profiles. Individual journals can require other
options, declarations or files. No acceptance or journal portal integration is
claimed. ACM affiliations require a country in template data, e.g.
`--template-data acm.json` with `{ "country": "Jordan" }`. Springer ships the
publisher class/style with original LPPL notices and source provenance. Other
classes/styles are provided by the TeX distribution. ACM and Springer starter
profiles declare pdfLaTeX only; mixed-script PDF export uses the Unicode article
or IEEE/Elsevier LuaLaTeX profiles. `toLatex` also generates Unicode article
source; use a submission package to collect its referenced assets.

```ts
import { createSubmissionPackage } from "@publisle/research";
import { template as ieee } from "@publisle/template-ieee";
import {
  compileLatexPackage,
  writeLatexPackage,
  exportPdf,
} from "@publisle/research/node";

const source = createSubmissionPackage(document, {
  template: ieee,
  engine: "lualatex",
});
const compiled = await compileLatexPackage(source, {
  sourceDirectory: "/absolute/manuscript-directory",
  compiler: "auto",
});
await writeLatexPackage(compiled, "/absolute/new-output-directory");
const defaultPdf = await exportPdf(document, {
  sourceDirectory: "/absolute/manuscript-directory",
});
```

`createLatexPackage` is the compatibility name for `createSubmissionPackage`.
Its default changed from IEEE to the generic Unicode article. Library callers
supply publisher objects or a `templates` registry; the CLI registers the starter
packs. Export accepts `templates` and Markdown codecs from trusted CLI
`--config host.ts`. `--template-data` supplies template-specific JSON. The CLI
has no publisher-specific rendering branches.

## Compilation and scripts

### Engine tiers

| Tier             | Setup                                  | Use                                                                                                                                                                                                                      |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Zero-TeX preview | None                                   | `publisle export article.md --to html --output preview.html` writes a self-contained page from the publication artifact (styles inlined, no TeX, no container). A drafting aid, not a journal PDF; hosts own real pages. |
| Pinned container | Docker only; `publisle setup compiler` | Reproducible PDF output with the digest-pinned image; no local TeX distribution.                                                                                                                                         |
| Native TeX       | latexmk + engine + fonts               | Full control; `publisle doctor` reports what is missing.                                                                                                                                                                 |

`--compiler auto` selects native tools only when template requirements and fonts
are installed, otherwise an already installed pinned container. It never pulls or
builds implicitly. Install the container explicitly with `publisle setup compiler`
(requires Docker). Its recipe pins Ubuntu by digest, freezes apt to a dated
snapshot, includes TeX/fonts, and records the built image ID in
`~/.cache/publisle/compiler.json`. Exports run with no network, no shell escape,
a read-only container root, and only the collected work directory mounted.
Native compilation remains available with `--compiler native`.

Native setup requires latexmk, the selected engine, BibTeX, template dependencies,
Fontconfig, and the fonts listed by `doctor`. Defaults are TeX Gyre Termes,
PakType Naskh Basic, FandolSong and TeX Gyre Termes Math. LuaLaTeX shapes Arabic,
selects Han fonts and renders mathematical notation. Missing glyphs fail the
build; other scripts require suitable font configuration and validation.

## Known limitations

The fast engine (`rust`, labeled "Fast · experimental" in the playground) is
experimental. Wide tables previously ran past the page. LuaLaTeX and pdfLaTeX
now keep six or more columns inside the measure by setting them in a smaller
font. The fast engine remains the better choice when a table is still wider
than that measure.

LuaLaTeX fails the build when TeX Gyre Termes has no glyph for a character, and
the PDF service names that character. A monochrome Noto Emoji fallback is pinned
for LuaLaTeX and the fast engine, so an emoji is drawn from that font instead of
becoming U+FFFD. pdfLaTeX still rejects non-ASCII prose.

The Arabic profile chooses Arabic page flow; an English publisher profile keeps
its own layout even with mixed text.

Assets must be local PDF/PNG/JPEG files inside the manuscript directory. Remote
figures, SVGs, and symlinks escaping that directory are refused. Builds have a
120-second default timeout and a 4 MiB process-output limit; failures produce no
published output. Layout overflows are diagnostics for author review. Authored
math is trusted TeX; native no-shell-escape is not a general TeX sandbox.

## Citations and metadata acquisition

`resolveDocument(document, style, options?)` uses pinned citeproc-js and bundled,
versioned CSL locales. It processes citation history and applies revisions to
previous citations, supporting locale terms, ibid/subsequent forms, name/year
suffix disambiguation, locators, sorting and bibliography formatting. Options
accept `locale`, additional `locales`, complete CSL-JSON `items` (including
structured names, particles, suffixes and editors), and explicit `noteIndices`.
Built-in styles remain `numeric` and `author-date`.

Bibliography imports retain original BibTeX and full CSL JSON records. Opaque
references remain literal with `opaque-reference-literal`; data is not invented.
Publisher BibTeX styles are separate template policy and may restrict citation
forms even though the CSL processor supports other forms.

```sh
publisle bibliography --doi 10.1109/JRPROC.1949.232969 --cache /tmp/bibliography-cache
publisle bibliography --url https://example.org/references.bib --cache /tmp/bibliography-cache
# Explicit refresh:
publisle bibliography --doi 10.1109/JRPROC.1949.232969 --cache /tmp/bibliography-cache --refresh
```

`lookupDoi` and `fetchBibliography` are opt-in Node APIs. HTTPS acquisition is
bounded, records URL/time/content digest, and reuses cached results offline.
Export never performs lookups or rewrites source references.

`pnpm test:research` compiles/rebuilds the starter profiles, validates JATS offline,
and exercises output refusal and failure paths. Set `PUBLISLE_CONTAINER_TEST=1`
to include the installed-container test. `PUBLISLE_RESEARCH_ARTIFACTS` retains
IEEE PDF/source/log/page-preview artifacts. The example manuscript and authors
are illustrative; its signal figure can be regenerated with
`python3 tools/research/ieee-figure.py`.

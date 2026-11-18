# MCP server

Publisle exposes its document model to AI assistants through the Model Context
Protocol (MCP). An assistant can draft a document, add and rearrange typed blocks,
validate it, preview the compiled HTML and export a PDF. Nothing is stored on the
server: every call receives the whole document and returns the new one.

[Watch it run on the MCP demo page](/mcp/) or call the hosted endpoint directly:

```text
POST https://api.publisle.xyz/mcp
```

## Feasibility

The server is feasible at low risk because Publisle already has the pieces:

- **Editing.** Every block operation in the playground (add, remove, move,
  duplicate, update, metadata, JSON import) lives in the framework-free
  `DocumentEditor`. Each MCP tool wraps one of those operations, so the assistant
  and the playground cannot drift apart.
- **Validation and preview.** `prepare` validates, and `compilePublicationAsync`
  produces the same HTML the playground previews. Markdown conversion comes from
  `@publisle/markdown`.
- **PDF.** The PDF service already compiles with the prebuilt Rust compiler
  (`publisle-pdf`, built in [publisle-rs](https://github.com/publisle/publisle-rs))
  inside a rootless Docker worker. The `compile_pdf` tool sends the document
  through that same queue, quota and image-fetch protections and always selects the
  Rust engine. Nothing is re-implemented.

The main risks, and how the design contains them:

| Risk                                                   | Containment                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| The API runs with a 48 MB heap and no JIT              | The MCP bundle loads lazily on the first `/mcp` call. A test runs every tool under those exact flags.  |
| A broken MCP bundle could take PDF export down with it | `/mcp` answers 503 if the bundle will not load. `/health` and `/pdf/compile` are untouched.            |
| Abuse of a public endpoint                             | The 256 KiB request cap, an in-flight cap, a per-call deadline and the per-IP PDF quota all apply.     |
| Cross-site use from a browser                          | The existing origin allow-list applies. Requests without an `Origin` header (desktop clients) pass.    |
| Specification drift                                    | Streamable HTTP with JSON responses only. The server negotiates the protocol version with the client.  |
| Server state leaking between users                     | There is none. The server has no sessions and never reads files or the network, except for PDF images. |

Out of scope: sessions, SSE streaming, server-initiated messages and OAuth. The
endpoint is public and has the same limits as `/pdf/compile`.

## Architecture

```text
MCP client --POST /mcp (JSON-RPC)--> publisle-api (server.mjs)
                                        |  lazy import
                                        v
                                     mcp.mjs  --> DocumentEditor, markdown, core, adapter-core
                                        |
                                        +-- compile_pdf --> queue + quota --> publisle-pdf (Rust)
```

The handler is a transport-agnostic function, `handleRpc(message, host)`. The API
route is a thin wrapper around it. The [demo page](/mcp/) runs the same handler
in the browser when the API is unreachable.

## Connect a client

Clients that accept a remote URL need only:

```json
{
  "mcpServers": {
    "publisle": { "url": "https://api.publisle.xyz/mcp" }
  }
}
```

Clients that only speak stdio can bridge with `npx mcp-remote https://api.publisle.xyz/mcp`.

## Tools

Tools take a `document` (the Publisle JSON document) where one is needed and return
the updated document in `structuredContent`.

| Tool              | What it does                                                                     |
| ----------------- | -------------------------------------------------------------------------------- |
| `list_blocks`     | Block types with label, description, category and default data                   |
| `list_templates`  | PDF templates, engines and required metadata                                     |
| `new_document`    | Start an empty document, optionally with metadata                                |
| `set_metadata`    | Replace the document metadata                                                    |
| `add_block`       | Insert a block of a type at an index, with default or supplied data              |
| `update_block`    | Replace a block's data                                                           |
| `remove_block`    | Delete a block                                                                   |
| `move_block`      | Move a block up or down                                                          |
| `duplicate_block` | Copy a block with a fresh id                                                     |
| `import_markdown` | Convert Markdown to a document, reporting diagnostics                            |
| `export_markdown` | Convert a document to Markdown                                                   |
| `import_json`     | Parse and normalize a JSON document string                                       |
| `validate`        | Prepare the document and return diagnostics                                      |
| `outline`         | Headings in order                                                                |
| `references`      | Labelled targets such as figures, equations and headings                         |
| `render_html`     | The compiled static HTML preview                                                 |
| `compile_pdf`     | Export a PDF with the Rust compiler; returns a base64 `application/pdf` resource |

Failures return a normal tool result with `isError: true` and a message the
assistant can act on, such as the diagnostics from `validate`. Protocol faults use
standard JSON-RPC error codes.

The server also offers the block catalog and a sample document as resources, and a
`draft_article` prompt.

## Limits

| Limit                | Value                                                               |
| -------------------- | ------------------------------------------------------------------- |
| Request body         | 256 KiB                                                             |
| Concurrent MCP calls | A small fixed cap; extra calls get a retryable error                |
| Per-call deadline    | A few seconds for editing tools; the PDF deadline for `compile_pdf` |
| PDF compilations     | 15 attempts per IP per 10 minutes; cache hits are free              |

## Run it locally

```sh
pnpm --filter @publisle/mcp test
pnpm --filter @publisle/mcp build
```

The first release keeps `@publisle/mcp` private. It is bundled into the PDF API
rather than published to npm, because publication is irreversible and the
interface may still change.

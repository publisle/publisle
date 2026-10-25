# Framework hosts

Hosts own routes, page metadata and implementation loaders. The adapters preserve
portable source semantics and diagnostics; they do not add a CMS or editor.

## Next.js App Router

Install `@publisle/adapter-next` with the core packages and React. The adapter
is server-first: `loadPublication` reads local Markdown/JSON, prepares it with
the host registry, and compiles a publication artifact without Vite.

```tsx
// app/page.tsx
import { loadPublication, PublisleArticle } from "@publisle/adapter-next";
import { coreBlockDefinitions } from "@publisle/blocks-core";
import { createRegistry } from "@publisle/core";
import { join } from "node:path";

export default async function Page() {
  const publication = await loadPublication(
    join(process.cwd(), "article.json"),
    { registry: createRegistry(coreBlockDefinitions) },
  );
  return <PublisleArticle publication={publication} instanceId="article" />;
}
```

`PublisleArticle` renders namespaced HTML for its explicit `instanceId`. A
static page has no Publisle client import. For an interactive article, pass
the reader manifest and host-owned implementation loaders through a client
component:

```tsx
// app/interactive/Reader.tsx
"use client";
import {
  ClientAttachment,
  type ClientAttachmentProps,
} from "@publisle/adapter-next/client";

export default function Reader({
  manifest,
  instanceId,
}: Pick<ClientAttachmentProps, "manifest" | "instanceId">) {
  return (
    <ClientAttachment
      manifest={manifest}
      instanceId={instanceId}
      implementations={{ "host:counter": () => import("./Counter") }}
    />
  );
}
```

The server route renders `Reader` as a child of `PublisleArticle`, using
`publicationReaderManifest(publication)`. `ClientAttachment` attaches the
shared controller after hydration and disposes it when React unmounts or
navigation replaces the article. See the [static Next example](../../examples/next/app/page.tsx)
and its [interactive route](../../examples/next/app/interactive/page.tsx).

Astro uses `publisleAstro()` in its config and `publisleLoader(files, options)` in a
content collection. Files map stable host collection IDs to local paths.
`@publisle/adapter-astro/Article.astro` emits publication HTML with no script.
Hosts add islands explicitly and call `attachArticle(root, manifest, environment)`
from `./runtime`, retaining its returned disposal function for removal/navigation.
The [Astro example](../../examples/astro/src/pages/index.astro) has a static route
and an [interactive host](../../examples/astro/src/pages/interactive.astro) whose
custom element disposes automatically when disconnected.

## Vue

Install `@publisle/adapter-vue`, Vue and Vite. `publisleVue` is an optional Vite
integration. It uses `vueTarget` to emit native Vue modules, so a Markdown
module can be imported directly by a Vue entry point:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { publisleVue } from "@publisle/adapter-vue";
import { coreBlockDefinitions } from "@publisle/blocks-core";
import { createRegistry } from "@publisle/core";

export default defineConfig({
  plugins: [
    await publisleVue({ registry: createRegistry(coreBlockDefinitions) }),
  ],
});
```

```ts
// src/main.ts
import { createApp, h } from "vue";
import Article from "./article.md";

createApp({
  render: () => h("main", null, [h(Article, { instanceId: "article" })]),
}).mount("#app");
```

Generated modules use Vue components and SSR; only referenced islands import the
controller runtime. For an existing `PublicationArtifact`, use
`PublisleArticle` from `@publisle/adapter-vue`; it renders the artifact and
attaches host implementation loaders after mounting. Both paths dispose on
unmount and repeated placements keep independent instance state. See the
[Vue entry point](../../examples/vue/src/main.ts) and [Vite config](../../examples/vue/vite.config.ts).

```sh
pnpm --filter @publisle/example-next build
pnpm --filter @publisle/example-astro build
pnpm --filter @publisle/example-vue build
pnpm test:distribution
pnpm test:acceptance
```

Production browser tests verify static delivery, repeated placements, independent
island state, ABI inputs and cleanup. A static Next page still includes Next's
own framework scripts; no Publisle client runtime is required. Static Astro pages
emit no JavaScript.

The independent Python renderer reads portable JSON directly:

```sh
python3 -B tools/python/render.py packages/contracts/fixtures/static-rendering.json
pnpm test:python
```

It supports a declared v1 static subset: prose, rich text/direction, lists,
quotes/code, figures/tables, labels, authored notes and numeric references.
It escapes HTML and refuses executable URLs. Math, interactive/custom behavior
and unsupported versions use readable fallback with diagnostics. It executes
neither migrations nor plugins and does not implement full CSL. Its shared
fixture is compared with the TypeScript renderer for supported semantics.

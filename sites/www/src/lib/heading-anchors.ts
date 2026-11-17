export interface TocEntry {
  readonly id: string;
  readonly level: 2 | 3;
  readonly title: string;
}

function slug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base || "section";
}

/** Give h2/h3 elements stable ids and return them in document order. */
export function anchorHeadings(html: string): {
  html: string;
  toc: TocEntry[];
} {
  const toc: TocEntry[] = [];
  const used = new Map<string, number>();
  const next = html.replace(
    /<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/g,
    (
      _full: string,
      level: string,
      rawAttrs: string | undefined,
      inner: string,
    ) => {
      let attrs = rawAttrs ?? "";
      const title = inner
        .replace(/<[^>]+>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const tag = level === "3" ? "h3" : "h2";
      if (!title) return `<${tag}${attrs}>${inner}</${tag}>`;
      const existing = /\sid="([^"]+)"/.exec(attrs);
      let id = existing?.[1] ?? slug(title);
      if (!existing) {
        const count = used.get(id) ?? 0;
        used.set(id, count + 1);
        if (count > 0) id = `${id}-${String(count + 1)}`;
        attrs = `${attrs} id="${id}"`;
      }
      toc.push({ id, level: tag === "h3" ? 3 : 2, title });
      return `<${tag}${attrs}>${inner}</${tag}>`;
    },
  );
  return { html: next, toc };
}

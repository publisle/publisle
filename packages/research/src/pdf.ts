import type { ArticleInline, ResearchLoss } from "./article.ts";
import type { ResolvedDocument } from "./resolve.ts";

const WIN_ANSI: Readonly<Record<number, number>> = {
  0x20ac: 0x80,
  0x201a: 0x82,
  0x0192: 0x83,
  0x201e: 0x84,
  0x2026: 0x85,
  0x2020: 0x86,
  0x2021: 0x87,
  0x02c6: 0x88,
  0x2030: 0x89,
  0x0160: 0x8a,
  0x2039: 0x8b,
  0x0152: 0x8c,
  0x017d: 0x8e,
  0x2018: 0x91,
  0x2019: 0x92,
  0x201c: 0x93,
  0x201d: 0x94,
  0x2022: 0x95,
  0x2013: 0x96,
  0x2014: 0x97,
  0x02dc: 0x98,
  0x2122: 0x99,
  0x0161: 0x9a,
  0x203a: 0x9b,
  0x0153: 0x9c,
  0x017e: 0x9e,
  0x0178: 0x9f,
};

function encode(value: string, losses: ResearchLoss[]): string {
  let encoded = "";
  let replaced = false;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    let byte = code;
    if (code >= 0x100) byte = WIN_ANSI[code] ?? -1;
    else if (code >= 0x80 && code <= 0x9f) byte = -1;
    if (byte < 32 || byte > 255) {
      replaced = true;
      byte = 0x3f;
    }
    encoded +=
      byte === 0x28 || byte === 0x29 || byte === 0x5c
        ? `\\${String.fromCharCode(byte)}`
        : byte >= 32 && byte <= 126
          ? String.fromCharCode(byte)
          : `\\${byte.toString(8).padStart(3, "0")}`;
  }
  if (
    replaced &&
    !losses.some((loss) => loss.code === "pdf-unencodable-character")
  )
    losses.push({
      code: "pdf-unencodable-character",
      message:
        "PDF text uses Helvetica WinAnsi. Characters outside that encoding are drawn as question marks.",
    });
  return encoded;
}

function plain(
  inlines: readonly ArticleInline[],
  resolved: ResolvedDocument,
  cursor: { index: number },
): string {
  return inlines
    .map((inline) => {
      if (inline.type === "break") return " ";
      if (inline.type === "citation") {
        const text = resolved.citations[cursor.index] ?? "";
        cursor.index += 1;
        return text;
      }
      if (inline.type === "math") return inline.value;
      if (inline.type === "link") return `${inline.value} (${inline.url})`;
      return inline.value;
    })
    .join("");
}

function wrap(text: string, size: number): string[] {
  const limit = Math.max(8, Math.floor((595 - 144) / (size * 0.56)));
  const words = text.split(/\s+/u).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current.length === 0 ? word : `${current} ${word}`;
    if (next.length <= limit) current = next;
    else {
      if (current.length > 0) lines.push(current);
      current = word.length <= limit ? word : word.slice(0, limit);
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length === 0 ? [""] : lines;
}

/** @deprecated Use exportPdf from @publisle/research/node for Unicode and page layout. */
export function toPdf(
  resolved: ResolvedDocument,
  options: { readonly allowLossy?: boolean } = {},
): {
  readonly pdf: Uint8Array;
  readonly losses: readonly ResearchLoss[];
} {
  const losses = [...resolved.losses];
  const cursor = { index: 0 };
  const lines: { text: string; size: number }[] = [];
  const add = (text: string, size: number) => {
    for (const line of wrap(text, size)) lines.push({ text: line, size });
  };
  add(resolved.article.title ?? "Untitled", 16);
  if (resolved.article.authors.length > 0)
    add(resolved.article.authors.join(", "), 11);
  let bibliographyWritten = false;
  const writeBibliography = () => {
    if (bibliographyWritten) return;
    bibliographyWritten = true;
    add("References", 13);
    for (const item of resolved.bibliography) add(item.text, 11);
  };
  for (const block of resolved.article.blocks) {
    if (block.kind === "heading")
      add(plain(block.inlines, resolved, cursor), 13);
    else if (block.kind === "paragraph")
      add(plain(block.inlines, resolved, cursor), 11);
    else if (block.kind === "list") {
      block.items.forEach((item, index) => {
        const marker = block.ordered ? `${String(index + 1)}. ` : "- ";
        const inlines = "content" in item ? item.content : item;
        add(`${marker}${plain(inlines, resolved, cursor)}`, 11);
      });
    } else if (block.kind === "quote") {
      for (const paragraph of block.paragraphs)
        add(plain(paragraph, resolved, cursor), 11);
    } else if (block.kind === "code" || block.kind === "math")
      add(block.value, 10);
    else if (block.kind === "figure") {
      losses.push({
        code: "pdf-figure-as-text",
        message: "Textual PDF renders figure descriptions only.",
      });
      add(`${block.alt} ${plain(block.caption, resolved, cursor)}`, 11);
    } else if (block.kind === "table") {
      if (!losses.some((loss) => loss.code === "table-rendered-as-text"))
        losses.push({
          code: "table-rendered-as-text",
          message: "Textual PDF renders tables as text rows.",
        });
      if (block.caption) add(plain(block.caption, resolved, cursor), 11);
      for (const row of block.rows)
        add(row.map((cell) => plain(cell, resolved, cursor)).join(" | "), 10);
    } else if (block.kind === "footnote") {
      add(
        `${block.id} ${block.paragraphs.map((paragraph) => plain(paragraph, resolved, cursor)).join(" ")}`,
        10,
      );
    } else writeBibliography();
  }
  writeBibliography();
  const pages: string[][] = [];
  let page: string[] = [];
  let y = 780;
  for (const line of lines) {
    if (y < 72) {
      pages.push(page);
      page = [];
      y = 780;
    }
    page.push(
      `BT /F1 ${String(line.size)} Tf 1 0 0 1 72 ${String(y)} Tm (${encode(line.text, losses)}) Tj ET`,
    );
    y -= line.size + 4;
  }
  pages.push(page);
  const objects: string[] = [];
  const pageIds: number[] = [];
  let id = 4;
  const contents: { page: number; content: number; stream: string }[] = [];
  for (const commands of pages) {
    const pageId = id++;
    const contentId = id++;
    pageIds.push(pageId);
    const stream = commands.join("\n");
    contents.push({ page: pageId, content: contentId, stream });
  }
  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n");
  objects.push(
    `2 0 obj << /Type /Pages /Count ${String(pageIds.length)} /Kids [${pageIds.map((pageId) => `${String(pageId)} 0 R`).join(" ")}] >> endobj\n`,
  );
  objects.push(
    "3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n",
  );
  for (const item of contents) {
    objects.push(
      `${String(item.page)} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${String(item.content)} 0 R /Resources << /Font << /F1 3 0 R >> >> >> endobj\n`,
    );
    objects.push(
      `${String(item.content)} 0 obj << /Length ${String(item.stream.length)} >> stream\n${item.stream}\nendstream endobj\n`,
    );
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${String(objects.length + 1)}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1))
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  if (
    !options.allowLossy &&
    losses.some((loss) => loss.code === "pdf-unencodable-character")
  )
    throw new Error(
      "Legacy PDF cannot encode this text. Use exportPdf or explicitly allowLossy.",
    );
  return { pdf: new TextEncoder().encode(pdf), losses };
}

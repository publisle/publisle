import { expect, it } from "vitest";
import { document, createBlock } from "@publisle/schema";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convertAssets, lowerImages } from "../src/worker.ts";
import { checkSvg } from "@publisle/research/node";

it("rejects SVG active content, file references, CSS imports and decoder escapes", () => {
  checkSvg(
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2" /></svg>',
  );
  checkSvg('<svg><path fill="url(#gradient)"/><use href="#shape" /></svg>');
  for (const body of [
    "<script>x</script>",
    "<foreignObject/>",
    '<image href="file:///etc/passwd"/>',
    '<image href="https://example.com/x"/>',
    '<image href="&#102;ile:///etc/passwd"/>',
    '<style>@import "https://example.com";</style>',
    "<style>a{fill:u\\72l(file:///x)}</style>",
    "<style>a{fill:url(file:///x)}</style>",
  ])
    expect(() => {
      checkSvg(`<svg>${body}</svg>`);
    }).toThrow();
  expect(() => {
    checkSvg('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>');
  }).toThrow();
});

it("embeds inline Markdown images as adjacent figures without mutating editor data", () => {
  const input = document({
    blocks: [
      createBlock({
        type: "publisle:paragraph",
        data: {
          content: [
            {
              type: "inlineImage",
              url: "https://example.com/a.png",
              alt: "Result",
            },
          ],
        },
      }),
    ],
  });
  const original = structuredClone(input);
  const lowered = lowerImages(input);
  expect(input).toEqual(original);
  expect(lowered.sources).toEqual(["https://example.com/a.png"]);
  expect(lowered.document.blocks[1]).toMatchObject({
    type: "publisle:figure",
    data: { alt: "Result", src: "https://example.com/a.png" },
  });
});

it("passes validated native SVGs through without replacing text with raster glyph boxes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "publisle-svg-worker-"));
  try {
    const bytes = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="30"><text font-family="ui-monospace" y="20">Axis 123</text></svg>',
    );
    await writeFile(join(directory, "image-0.input"), bytes);
    const assets = [
      {
        source: "https://fixture.invalid/axis.svg",
        file: "image-0.input",
        mime: "image/svg+xml",
      },
    ];
    const output = await convertAssets(assets, directory, true);
    expect(output[0]?.file).toBe("image-0.svg");
    expect(output[0]?.bytes).toEqual(bytes);
    await writeFile(
      join(directory, "image-0.input"),
      "<svg><script>bad</script></svg>",
    );
    await expect(convertAssets(assets, directory, true)).rejects.toThrow(
      /active content/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

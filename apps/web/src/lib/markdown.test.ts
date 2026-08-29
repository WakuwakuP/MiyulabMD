import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown, renderMarkdownHtml } from "./markdown.ts";

test("renderMarkdown renders GFM tables with header and body cells", async () => {
  const html = await renderMarkdown(`| A | B |
| --- | --- |
| 1 | 2 |`);
  assert.match(html, /<table[\s>]/i);
  assert.match(html, /<th[\s>]/i);
  assert.match(html, /<td[\s>]/i);
  assert.match(html, />A</);
  assert.match(html, />1</);
});

test("renderMarkdownHtml is sync and does not fetch OGP", () => {
  const html = renderMarkdownHtml("https://example.com/preview-perf\n");
  assert.match(html, /example\.com\/preview-perf/);
});

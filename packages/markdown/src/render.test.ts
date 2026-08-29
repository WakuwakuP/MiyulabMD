import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdownHtml } from "./render.ts";

test("renderMarkdownHtml renders GFM tables", () => {
  const html = renderMarkdownHtml(`| A | B |
| --- | --- |
| 1 | 2 |`);
  assert.match(html, /<table[\s>]/i);
  assert.match(html, /<th[\s>]/i);
  assert.match(html, /<td[\s>]/i);
  assert.match(html, />A</);
  assert.match(html, />1</);
});

test("renderMarkdownHtml prefixes heading ids for TOC", () => {
  const html = renderMarkdownHtml("# Hello world\n");
  assert.match(html, /id="user-content-hello-world"/);
});

test("renderMarkdownHtml is sync and does not need OGP cards", () => {
  const html = renderMarkdownHtml("https://example.com/preview-perf\n");
  assert.match(html, /example\.com\/preview-perf/);
});

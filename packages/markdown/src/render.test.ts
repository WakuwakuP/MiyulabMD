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

test("renderMarkdownHtml highlights fenced code and shows filename", () => {
  const html = renderMarkdownHtml(
    "```typescript:hoge.ts\nconst answer = 42;\n```\n",
  );
  assert.match(html, /class="md-code-filename"/);
  assert.match(html, />hoge\.ts</);
  assert.match(html, /language-typescript/);
  assert.match(html, /hljs-/);
  assert.doesNotMatch(html, /language-typescript:hoge\.ts/);
});

test("renderMarkdownHtml skips YAML frontmatter", () => {
  const html = renderMarkdownHtml(
    "---\ntitle: Hidden\n---\n\n# Visible heading\n",
  );
  assert.match(html, /Visible heading/);
  assert.doesNotMatch(html, /Hidden/);
});

test("renderMarkdownHtml infers highlight language from a filename fence", () => {
  const html = renderMarkdownHtml("```hoge.ts\nconst answer = 42;\n```\n");
  assert.match(html, />hoge\.ts</);
  assert.match(html, /language-typescript/);
});

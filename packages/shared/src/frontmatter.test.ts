import assert from "node:assert/strict";
import { test } from "node:test";
import {
  articleTemplateMarkdown,
  ensureArticleMarkdown,
  markdownBody,
  readArticleFrontmatter,
  splitMarkdownFrontmatter,
  validateArticleDocument,
} from "./frontmatter.ts";
import { titleFromMarkdown } from "./title.ts";

const SAMPLE = `---
title: 公開タイトル
draft: false
tags:
  - a
  - b
pubDate: 2026-09-04
---

# 見出し
`;

test("splitMarkdownFrontmatter reads a closed YAML block", () => {
  const split = splitMarkdownFrontmatter(SAMPLE);
  assert.equal(split.unclosed, false);
  assert.match(split.raw ?? "", /title: 公開タイトル/);
  assert.equal(split.body.trimStart(), "# 見出し\n");
  assert.equal(markdownBody("# only\n"), "# only\n");
});

test("readArticleFrontmatter parses types including dates", () => {
  const read = readArticleFrontmatter(SAMPLE);
  assert.deepEqual(read.issues, []);
  assert.equal(read.data.title, "公開タイトル");
  assert.equal(read.data.draft, false);
  assert.deepEqual(read.data.tags, ["a", "b"]);
  assert.equal(read.data.pubDate, "2026-09-04");
});

test("readArticleFrontmatter reports unclosed and invalid YAML", () => {
  const unclosed = readArticleFrontmatter("---\ntitle: x\n");
  assert.match(unclosed.issues[0]?.message ?? "", /閉じ/);
  const invalid = readArticleFrontmatter("---\n[\n---\n");
  assert.match(invalid.issues[0]?.message ?? "", /オブジェクト|YAML/);
});

test("validateArticleDocument checks required fields and types", () => {
  const schema = [
    { key: "title", type: "string" as const, required: true },
    { key: "count", type: "number" as const, required: true },
  ];
  const missing = validateArticleDocument(schema, SAMPLE);
  assert.ok(missing.issues.some((issue) => issue.key === "count"));

  const ok = validateArticleDocument(
    schema,
    "---\ntitle: A\ncount: 1\n---\n\n# A\n",
  );
  assert.deepEqual(ok.issues, []);

  const none = validateArticleDocument(schema, "# A\n");
  assert.match(none.issues[0]?.message ?? "", /frontmatter/);
});

test("articleTemplateMarkdown and ensureArticleMarkdown insert YAML", () => {
  const schema = [
    { key: "title", type: "string" as const },
    { key: "draft", type: "boolean" as const, default: false },
  ];
  const created = articleTemplateMarkdown(schema, "無題");
  assert.match(created, /^---\n/);
  assert.match(created, /draft: false/);
  assert.match(created, /# 無題\n$/);

  const existing = ensureArticleMarkdown(created, schema);
  assert.equal(existing, created);

  const injected = ensureArticleMarkdown("# 無題\n", schema);
  assert.match(injected, /^---\n/);
  assert.match(injected, /# 無題\n$/);
});

test("titleFromMarkdown skips frontmatter", () => {
  assert.equal(titleFromMarkdown(SAMPLE), "見出し");
  assert.equal(titleFromMarkdown("# そのまま\n"), "そのまま");
});

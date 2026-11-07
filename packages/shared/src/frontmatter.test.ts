import assert from "node:assert/strict";
import { test } from "node:test";
import {
  articleMetaFromNote,
  articleTemplateMarkdown,
  articleValuesEqual,
  ensureArticleMarkdown,
  markdownBody,
  readArticleFrontmatter,
  splitMarkdownFrontmatter,
  validateArticleDocument,
  withClosedFrontmatter,
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

test("optional frontmatter keeps arbitrary nested keys without an article schema", () => {
  assert.deepEqual(readArticleFrontmatter("# Note\n"), {
    body: "# Note\n",
    data: {},
    issues: [],
  });
  const read = readArticleFrontmatter(
    "---\ncustom:\n  labels: [one, two]\n  enabled: true\n__proto__:\n  custom: value\nconstructor: personal\n---\n\n# Note\n",
  );
  assert.deepEqual(read.issues, []);
  assert.deepEqual(read.data, {
    ["__proto__"]: { custom: "value" },
    constructor: "personal",
    custom: { enabled: true, labels: ["one", "two"] },
  });
  assert.equal(Object.getPrototypeOf(read.data), Object.prototype);
  assert.equal(read.body, "\n# Note\n");
});

test("malformed frontmatter preserves the body and closed raw YAML on edits", () => {
  for (const raw of ["custom: [", "- not a mapping", "custom: a\ncustom: b"]) {
    const markdown = `---\n${raw}\n---\n\n# Body\n`;
    const read = readArticleFrontmatter(markdown);
    assert.ok(read.issues.length > 0);
    assert.equal(read.body, "\n# Body\n");
    assert.equal(markdownBody(markdown), read.body);
    assert.equal(
      withClosedFrontmatter(markdown, "# Edited\n"),
      `---\n${raw}\n---\n\n# Edited\n`,
    );
    assert.equal(ensureArticleMarkdown(markdown, []), markdown);
  }
  const unclosed = "---\ncustom: value\n\n# Body\n";
  assert.equal(readArticleFrontmatter(unclosed).body, unclosed);
  assert.equal(markdownBody(unclosed), unclosed);
});

test("article validation checks types, enums and fixed values but preserves unknown keys", () => {
  const schema = [
    { key: "count", required: true, type: "number" as const },
    { default: "news", fixed: true, key: "kind", type: "string" as const },
    { enum: ["ja", "en"], key: "lang", type: "string" as const },
  ];
  const invalid = validateArticleDocument(
    schema,
    "---\ncount: wrong\nkind: other\nlang: xx\n---\n# Body\n",
  );
  assert.deepEqual(
    invalid.issues.map((issue) => issue.key),
    ["count", "kind", "lang"],
  );
  const valid = validateArticleDocument(
    schema,
    "---\ncount: 1\ncustom: keep\n---\n# Body\n",
  );
  assert.deepEqual(valid.issues, []);
  assert.equal(valid.data.custom, "keep");
});

test("readArticleFrontmatter reports unclosed and invalid YAML", () => {
  const unclosed = readArticleFrontmatter("---\ntitle: x\n");
  assert.match(unclosed.issues[0]?.message ?? "", /閉じ/);
  const invalid = readArticleFrontmatter("---\n[\n---\n");
  assert.match(invalid.issues[0]?.message ?? "", /オブジェクト|YAML/);
});

test("validateArticleDocument checks required fields and types", () => {
  const schema = [
    { key: "title", required: true, type: "string" as const },
    { key: "count", required: true, type: "number" as const },
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
    { default: false, key: "draft", type: "boolean" as const },
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

test("articleMetaFromNote falls back to stored JSON without YAML", () => {
  assert.deepEqual(
    articleMetaFromNote("# Hello\n", '{"draft":false,"title":"旧"}'),
    { draft: false, title: "旧" },
  );
  assert.equal(
    articleMetaFromNote(SAMPLE, '{"title":"旧"}').title,
    "公開タイトル",
  );
});

test("articleValuesEqual compares string arrays by contents", () => {
  assert.equal(articleValuesEqual(["a", "b"], ["a", "b"]), true);
  assert.equal(articleValuesEqual(["a"], ["b"]), false);
  const fixed = validateArticleDocument(
    [{ default: ["news"], fixed: true, key: "tags", type: "string[]" }],
    "---\ntags:\n  - news\n---\n\n# A\n",
  );
  assert.deepEqual(fixed.issues, []);
});

test("withClosedFrontmatter keeps YAML and replaces the body", () => {
  const next = withClosedFrontmatter(SAMPLE, "# 新しい本文\n");
  assert.match(next, /^---\n/);
  assert.match(next, /title: 公開タイトル/);
  assert.match(next, /# 新しい本文\n$/);
  assert.equal(withClosedFrontmatter("# only\n", "# next\n"), "# next\n");
});

test("titleFromMarkdown skips frontmatter", () => {
  assert.equal(titleFromMarkdown(SAMPLE), "見出し");
  assert.equal(titleFromMarkdown("# そのまま\n"), "そのまま");
});

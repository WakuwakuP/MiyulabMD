import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARTICLE_LIST_DEFAULT_PER_PAGE,
  ARTICLE_LIST_MAX_PER_PAGE,
  articleEditUrl,
  articleSlug,
  isArticleSourceDirty,
  matchArticleSource,
  mergeArticleData,
  parseArticleListQuery,
  parseArticleSchema,
  resolveArticleListFolder,
} from "./article.ts";

test("parseArticleSchema rejects duplicate keys and bad types", () => {
  const ok = parseArticleSchema([
    { key: "category", type: "string", fixed: true, default: "お知らせ" },
    { key: "tags", type: "string[]", default: [] },
  ]);
  assert.ok(Array.isArray(ok));
  assert.equal(ok[0]?.key, "category");

  const dup = parseArticleSchema([
    { key: "title", type: "string" },
    { key: "title", type: "string" },
  ]);
  assert.ok("error" in dup);

  const badType = parseArticleSchema([{ key: "n", type: "object" }]);
  assert.ok("error" in badType);
});

test("mergeArticleData prefers fixed values over note meta", () => {
  const data = mergeArticleData({
    schema: [
      { key: "category", type: "string", fixed: true, default: "お知らせ" },
      { key: "description", type: "string" },
      { key: "tags", type: "string[]", default: [] },
    ],
    noteMeta: {
      category: "議事録",
      description: "概要",
    },
    title: "見出し",
  });
  assert.equal(data.category, "お知らせ");
  assert.equal(data.description, "概要");
  assert.deepEqual(data.tags, []);
  assert.equal(data.title, "見出し");
});

test("mergeArticleData keeps an explicit title from note meta", () => {
  const data = mergeArticleData({
    schema: [{ key: "title", type: "string" }],
    noteMeta: { title: "公開タイトル" },
    title: "見出し",
  });
  assert.equal(data.title, "公開タイトル");
});

test("matchArticleSource uses the longest folder prefix", () => {
  const sources = [
    { id: "blog", folder: "blog" },
    { id: "tech", folder: "blog/tech" },
  ];
  assert.equal(matchArticleSource("blog/tech/2026", sources)?.id, "tech");
  assert.equal(matchArticleSource("blog/daily", sources)?.id, "blog");
  assert.equal(matchArticleSource("other", sources), null);
});

test("isArticleSourceDirty compares max updated_at to last dispatch", () => {
  assert.equal(isArticleSourceDirty(null, null), false);
  assert.equal(isArticleSourceDirty(null, 10), true);
  assert.equal(isArticleSourceDirty(20, 10), false);
  assert.equal(isArticleSourceDirty(10, 20), true);
});

test("parseArticleListQuery defaults, clamps, and rejects bad values", () => {
  assert.deepEqual(parseArticleListQuery(new URLSearchParams()), {
    page: 1,
    perPage: ARTICLE_LIST_DEFAULT_PER_PAGE,
    folder: null,
  });
  assert.deepEqual(
    parseArticleListQuery(
      new URLSearchParams("page=3&perPage=10&folder=work/infra/db"),
    ),
    { page: 3, perPage: 10, folder: "work/infra/db" },
  );
  const clamped = parseArticleListQuery(
    new URLSearchParams(`perPage=${ARTICLE_LIST_MAX_PER_PAGE + 40}`),
  );
  assert.ok(!("error" in clamped));
  assert.equal(clamped.perPage, ARTICLE_LIST_MAX_PER_PAGE);
  assert.ok("error" in parseArticleListQuery(new URLSearchParams("page=0")));
  assert.ok(
    "error" in parseArticleListQuery(new URLSearchParams("perPage=abc")),
  );
});

test("resolveArticleListFolder allows the source and its descendants", () => {
  assert.equal(resolveArticleListFolder("work", null), "work");
  assert.equal(
    resolveArticleListFolder("work", "work/infra/db"),
    "work/infra/db",
  );
  assert.ok("error" in resolveArticleListFolder("work", "play"));
});

test("articleSlug and articleEditUrl", () => {
  assert.equal(articleSlug("hello", "AbCdEf12"), "hello");
  assert.equal(articleSlug(null, "AbCdEf12"), "AbCdEf12");
  assert.equal(
    articleEditUrl("https://md.example.com/", "AbCdEf12"),
    "https://md.example.com/n/AbCdEf12",
  );
});

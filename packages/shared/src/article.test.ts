import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARTICLE_LIST_DEFAULT_PER_PAGE,
  ARTICLE_LIST_MAX_PER_PAGE,
  articleDriveFolderLabel,
  articleEditUrl,
  articleFolderWithinSource,
  articleSlug,
  canDispatchArticleSource,
  canDispatchSharedDriveSource,
  canManageSharedDriveSource,
  canOfferArticleDispatch,
  isArticleSourceDirty,
  isReservedArticleFolderPath,
  matchArticleSource,
  mergeArticleData,
  parseArticleDriveFolder,
  parseArticleListQuery,
  parseArticleSchema,
  resolveArticleListFolder,
  translateArticleUpdateAudience,
} from "./article.ts";

test("parseArticleSchema rejects duplicate keys and bad types", () => {
  const ok = parseArticleSchema([
    { default: "お知らせ", fixed: true, key: "category", type: "string" },
    { default: [], key: "tags", type: "string[]" },
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
    noteMeta: {
      category: "議事録",
      description: "概要",
    },
    schema: [
      { default: "お知らせ", fixed: true, key: "category", type: "string" },
      { key: "description", type: "string" },
      { default: [], key: "tags", type: "string[]" },
    ],
    title: "見出し",
  });
  assert.equal(data.category, "お知らせ");
  assert.equal(data.description, "概要");
  assert.deepEqual(data.tags, []);
  assert.equal(data.title, "見出し");
});

test("mergeArticleData keeps an explicit title from note meta", () => {
  const data = mergeArticleData({
    noteMeta: { title: "公開タイトル" },
    schema: [{ key: "title", type: "string" }],
    title: "見出し",
  });
  assert.equal(data.title, "公開タイトル");
});

test("matchArticleSource uses the longest folder prefix", () => {
  const sources = [
    { folder: "blog", id: "blog" },
    { folder: "blog/tech", id: "tech" },
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
    folder: null,
    page: 1,
    perPage: ARTICLE_LIST_DEFAULT_PER_PAGE,
  });
  assert.deepEqual(
    parseArticleListQuery(
      new URLSearchParams("page=3&perPage=10&folder=work/infra/db"),
    ),
    { folder: "work/infra/db", page: 3, perPage: 10 },
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

test("d:drive:folder addresses a shared drive and cannot be a folder path", () => {
  assert.equal(
    articleDriveFolderLabel("研究室", "sites/hoge"),
    "d:研究室:sites/hoge",
  );
  assert.equal(articleDriveFolderLabel("研究室", ""), "d:研究室:");
  assert.deepEqual(parseArticleDriveFolder("d:研究室:sites/hoge"), {
    driveName: "研究室",
    folder: "sites/hoge",
  });
  assert.deepEqual(parseArticleDriveFolder("d:研究室:"), {
    driveName: "研究室",
    folder: "",
  });
  assert.equal(parseArticleDriveFolder("sites/hoge"), null);
  assert.equal(parseArticleDriveFolder("d:研究室"), null);
  assert.equal(isReservedArticleFolderPath("d:研究室:blog"), true);
  assert.equal(isReservedArticleFolderPath("parent/d:研究室:blog"), true);
  assert.equal(isReservedArticleFolderPath("sites/hoge"), false);
  assert.equal(
    articleFolderWithinSource("blog", "d:研究室:blog/posts", "研究室"),
    "blog/posts",
  );
  assert.equal(
    articleFolderWithinSource("blog", "blog/posts", "研究室"),
    "blog/posts",
  );
  assert.ok(
    "error" in articleFolderWithinSource("blog", "d:別ドライブ:blog", "研究室"),
  );
  assert.equal(articleFolderWithinSource("", "d:研究室:", "研究室"), "");
  assert.equal(articleFolderWithinSource("", null, "研究室"), "");
});

test("site update is the owner or people who can edit the folder", () => {
  assert.equal(
    canDispatchArticleSource({
      audience: "self",
      canEdit: false,
      isOwner: true,
    }),
    true,
  );
  assert.equal(
    canDispatchArticleSource({
      audience: "self",
      canEdit: true,
      isOwner: false,
    }),
    false,
  );
  assert.equal(
    canDispatchArticleSource({
      audience: "editors",
      canEdit: true,
      isOwner: false,
    }),
    true,
  );
  assert.equal(
    canDispatchArticleSource({
      audience: "editors",
      canEdit: false,
      isOwner: false,
    }),
    false,
  );
  assert.equal(
    canOfferArticleDispatch({
      audience: "editors",
      isOwner: false,
      openedCanView: false,
      sourceCanEdit: true,
    }),
    false,
  );
  assert.equal(
    canOfferArticleDispatch({
      audience: "self",
      isOwner: false,
      openedCanView: true,
      sourceCanEdit: true,
    }),
    false,
  );
  assert.equal(
    canOfferArticleDispatch({
      audience: "editors",
      isOwner: false,
      openedCanView: true,
      sourceCanEdit: true,
    }),
    true,
  );
});

test("shared drive webhook follows the drive role and the source setting", () => {
  assert.equal(canManageSharedDriveSource("manager"), true);
  assert.equal(canManageSharedDriveSource("editor"), false);
  assert.equal(
    canDispatchSharedDriveSource({ audience: "managers", role: "manager" }),
    true,
  );
  assert.equal(
    canDispatchSharedDriveSource({ audience: "managers", role: "editor" }),
    false,
  );
  assert.equal(
    canDispatchSharedDriveSource({
      audience: "managers_or_editors",
      role: "editor",
    }),
    true,
  );
  assert.equal(
    canDispatchSharedDriveSource({
      audience: "managers_or_editors",
      role: "viewer",
    }),
    false,
  );
});

test("article audience translates when the subject kind changes", () => {
  assert.equal(
    translateArticleUpdateAudience("user", "shared_drive", "self"),
    "managers",
  );
  assert.equal(
    translateArticleUpdateAudience("user", "shared_drive", "editors"),
    "managers_or_editors",
  );
  assert.equal(
    translateArticleUpdateAudience("shared_drive", "user", "managers"),
    "self",
  );
  assert.equal(
    translateArticleUpdateAudience(
      "shared_drive",
      "user",
      "managers_or_editors",
    ),
    "editors",
  );
  assert.equal(
    translateArticleUpdateAudience(
      "shared_drive",
      "shared_drive",
      "managers_or_editors",
    ),
    "managers_or_editors",
  );
});

test("articleSlug and articleEditUrl", () => {
  assert.equal(articleSlug("hello", "AbCdEf12"), "hello");
  assert.equal(articleSlug(null, "AbCdEf12"), "AbCdEf12");
  assert.equal(
    articleEditUrl("https://md.example.com/", "AbCdEf12"),
    "https://md.example.com/n/AbCdEf12",
  );
});

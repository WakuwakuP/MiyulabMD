import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { type TestContext, test } from "node:test";
import {
  ARTICLE_LIST_MAX_PER_PAGE,
  type ArticleSchemaField,
} from "@miyulabmd/shared";
import { testD1 } from "../../scripts/test-d1.mjs";
import { upsertUserByEmail } from "../db/users.ts";
import {
  createArticleService,
  escapeLikePattern,
  isAllowedWebhookUrl,
  sourceNoteFilter,
} from "./articles.ts";
import { createNoteService, persistMarkdownSnapshot } from "./notes.ts";
import { createSharedDrive, inviteDriveMember } from "./shared-drives.ts";

async function articleFixture(t: TestContext) {
  const database = testD1();
  t.after(() => database.sqlite.close());
  const migrations = new URL("../db/migrations/", import.meta.url);
  for (const file of readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    database.sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
  }
  const env = database.env as unknown as Env;
  const owner = await upsertUserByEmail(env, "owner@example.invalid", "Owner");
  const schema: ArticleSchemaField[] = [
    { key: "title", required: true, type: "string" },
    { key: "count", required: true, type: "number" },
    { default: "news", fixed: true, key: "kind", type: "string" },
  ];
  const articles = createArticleService(env);
  const source = await articles.createSource(owner, owner.id, {
    folder: "blog",
    name: "Blog",
    schema,
    webhookUrl: "https://example.invalid/hook",
  });
  assert.ok(!("error" in source));
  const notes = createNoteService(env);
  const note = await notes.create(owner, {
    folder: "blog/nested",
    markdown: "---\ntitle: Article\ncount: 1\ncustom: keep\n---\n\n# Body\n",
  });
  assert.ok(!("error" in note));
  const fetch = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 204 }),
  );
  return { ...database, articles, env, fetch, note, notes, owner, source };
}

test("dispatch rejects invalid saved articles without sending a webhook or updating timestamps", async (t) => {
  const { articles, env, fetch, note, notes, owner, source, sqlite } =
    await articleFixture(t);
  const cases = [
    ["# Missing YAML\n", /frontmatter/],
    ["---\ntitle: Article\ndraft: true\n---\n# Body\n", /count は必須/],
    ["---\ntitle: Article\ncount: wrong\n---\n# Body\n", /count の型/],
    [
      "---\ntitle: Article\ncount: 1\nkind: other\n---\n# Body\n",
      /kind は news で固定/,
    ],
    ["---\nsecret: [\n---\n# Body\n", /YAML/],
    ["---\ntitle: Article\n# Body\n", /閉じ/],
  ] as const;
  for (const [markdown, message] of cases) {
    assert.equal(
      await persistMarkdownSnapshot(env, note.id, markdown),
      "persisted",
    );
    const loaded = await notes.get(note.id, owner);
    assert.equal(loaded.kind, "ok");
    if (loaded.kind === "ok") {
      assert.equal(loaded.note.markdown, markdown);
    }
    const result = await articles.dispatch(owner, source.id);
    assert.ok(result && "error" in result);
    assert.equal(result.status, 422);
    assert.match(result.error, message);
    assert.ok(result.error.includes(`/n/${note.shortId}`));
    assert.equal(fetch.mock.callCount(), 0);
    const stored = sqlite
      .prepare(
        "SELECT last_dispatched_at, updated_at FROM article_sources WHERE id = ?",
      )
      .get(source.id);
    assert.equal(stored?.last_dispatched_at, null);
    assert.equal(stored?.updated_at, source.updatedAt);
    // Article reads remain compatible even when publishing would be refused.
    assert.ok(
      await articles.getEntry(
        owner,
        source.id,
        note.shortId,
        "https://md.example.invalid",
      ),
    );
    const listed = await articles.listEntries(
      owner,
      source.id,
      "https://md.example.invalid",
      { folder: null, page: 1, perPage: 50 },
    );
    assert.ok(listed && !("error" in listed));
    assert.equal(listed.total, 1);
  }
});

test("dispatch validates only the source owner's subtree and sends valid articles unchanged", async (t) => {
  const { articles, env, fetch, note, notes, owner, source, sqlite } =
    await articleFixture(t);
  const other = await upsertUserByEmail(env, "other@example.invalid", "Other");
  for (const [user, folder] of [
    [owner, "blog-other"],
    [other, "blog/nested"],
  ] as const) {
    const outside = await notes.create(user, {
      folder,
      markdown: "# No YAML\n",
    });
    assert.ok(!("error" in outside));
  }
  assert.deepEqual(await articles.dispatch(owner, source.id), { ok: true });
  assert.equal(fetch.mock.callCount(), 1);
  const call = fetch.mock.calls[0];
  assert.equal(call.arguments[0], "https://example.invalid/hook");
  assert.equal(call.arguments[1]?.method, "POST");
  assert.deepEqual(JSON.parse(String(call.arguments[1]?.body)), {
    client_payload: { collectionId: source.id, folder: "blog" },
    event_type: "miyulabmd-publish",
  });
  assert.equal(
    typeof sqlite
      .prepare("SELECT last_dispatched_at FROM article_sources WHERE id = ?")
      .get(source.id)?.last_dispatched_at,
    "number",
  );
  const entry = await articles.getEntry(
    owner,
    source.id,
    note.shortId,
    "https://md.example.invalid",
  );
  assert.equal(entry?.entry.markdown, "\n# Body\n");
  assert.deepEqual(entry?.entry.data, {
    count: 1,
    kind: "news",
    title: "Article",
  });
  const loaded = await notes.get(note.id, owner);
  assert.equal(loaded.kind, "ok");
  if (loaded.kind === "ok") {
    assert.equal(loaded.note.markdown, note.markdown);
    assert.equal(loaded.note.articleMeta.custom, "keep");
  }
});

test("dispatch checks articles beyond the first page", async (t) => {
  const { articles, fetch, note, owner, source, sqlite } =
    await articleFixture(t);
  const insert = sqlite.prepare(
    `INSERT INTO notes (id, short_id, owner_id, folder, permission, markdown_snapshot, created_at, updated_at)
     VALUES (?, ?, ?, 'blog', 'private', ?, 1, 1)`,
  );
  for (let index = 0; index < ARTICLE_LIST_MAX_PER_PAGE; index++) {
    const id = `page-${String(index).padStart(3, "0")}`;
    insert.run(id, id, owner.id, note.markdown);
  }
  insert.run("zz-invalid", "zz-invalid", owner.id, "# No YAML\n");
  const result = await articles.dispatch(owner, source.id);
  assert.ok(result && "error" in result);
  assert.equal(result.status, 422);
  assert.match(result.error, /zz-invalid/);
  assert.equal(fetch.mock.callCount(), 0);
});

test("dispatch checks authorization first and does not disclose inaccessible invalid notes", async (t) => {
  const { articles, env, fetch, note, owner, source, sqlite } =
    await articleFixture(t);
  const editor = await upsertUserByEmail(
    env,
    "editor@example.invalid",
    "Editor",
  );
  assert.equal(await articles.dispatch(editor, source.id), null);
  assert.equal(await articles.dispatch(owner, "missing"), null);
  sqlite
    .prepare(
      "UPDATE article_sources SET update_audience = 'editors' WHERE id = ?",
    )
    .run(source.id);
  sqlite
    .prepare(
      "INSERT OR REPLACE INTO folder_policies (owner_id, folder, read_scope, write_scope, updated_at) VALUES (?, 'blog', 'signed_in', 'signed_in', 1)",
    )
    .run(owner.id);
  sqlite
    .prepare(
      "UPDATE notes SET read_scope = 'self', write_scope = 'self' WHERE id = ?",
    )
    .run(note.id);
  await persistMarkdownSnapshot(
    env,
    note.id,
    "---\nsecret: [\n---\n# Secret title\n",
  );
  const result = await articles.dispatch(editor, source.id);
  assert.ok(result && "error" in result);
  assert.equal(result.status, 422);
  assert.match(result.error, /所有者または管理者/);
  assert.doesNotMatch(result.error, /Secret|secret|YAML/);
  assert.ok(!result.error.includes(note.shortId));
  assert.equal(fetch.mock.callCount(), 0);
});

test("article creation still supplies the schema template", async (t) => {
  const { notes, owner } = await articleFixture(t);
  const created = await notes.create(owner, {
    folder: "blog",
    title: "New article",
  });
  assert.ok(!("error" in created));
  assert.match(created.markdown, /^---\n/);
  assert.match(created.markdown, /title: New article/);
  assert.match(created.markdown, /kind: news/);
  assert.match(created.markdown, /# New article\n$/);
});

test("shared-drive root dispatch validates with membership-based error visibility", async (t) => {
  const { articles, env, fetch, note, notes, owner, source } =
    await articleFixture(t);
  const drive = await createSharedDrive(env, owner, "Blog drive");
  assert.equal(drive.kind, "ok");
  if (drive.kind !== "ok") {
    return;
  }
  const editor = await upsertUserByEmail(
    env,
    "editor@example.invalid",
    "Editor",
  );
  const invited = await inviteDriveMember(
    env,
    drive.result.id,
    editor.email,
    "editor",
    owner,
  );
  assert.equal(invited.kind, "ok");
  const root = await articles.createSource(owner, drive.result.id, {
    folderId: drive.result.rootFolderId,
    name: "Drive blog",
    schema: source.schema,
    updateAudience: "managers_or_editors",
    webhookUrl: "https://example.invalid/drive-hook",
  });
  assert.ok(!("error" in root));
  // An empty source is still publishable.
  assert.deepEqual(await articles.dispatch(editor, root.id), { ok: true });
  const created = await notes.create(owner, {
    folderId: drive.result.rootFolderId,
    markdown: note.markdown,
  });
  assert.ok(!("error" in created));
  await persistMarkdownSnapshot(
    env,
    created.id,
    "---\ntitle: Article\n---\n# Body\n",
  );
  const result = await articles.dispatch(editor, root.id);
  assert.ok(result && "error" in result);
  assert.equal(result.status, 422);
  assert.match(result.error, /count は必須/);
  assert.ok(result.error.includes(`/n/${created.shortId}`));
  assert.equal(fetch.mock.callCount(), 1);
  await persistMarkdownSnapshot(env, created.id, note.markdown);
  assert.deepEqual(await articles.dispatch(editor, root.id), { ok: true });
  assert.equal(fetch.mock.callCount(), 2);
});

test("dispatch retains missing-webhook and upstream failure handling", async (t) => {
  const { articles, fetch, owner, source, sqlite } = await articleFixture(t);
  const timestamp = sqlite.prepare(
    "SELECT last_dispatched_at FROM article_sources WHERE id = ?",
  );
  fetch.mock.mockImplementation(
    async () => new Response(null, { status: 503 }),
  );
  assert.deepEqual(await articles.dispatch(owner, source.id), {
    error: "Webhook が 503 を返しました",
    status: 502,
  });
  assert.equal(timestamp.get(source.id)?.last_dispatched_at, null);
  fetch.mock.mockImplementation(() => Promise.reject(new Error("offline")));
  assert.deepEqual(await articles.dispatch(owner, source.id), {
    error: "Webhook の送信に失敗しました",
    status: 502,
  });
  assert.equal(timestamp.get(source.id)?.last_dispatched_at, null);
  sqlite
    .prepare("UPDATE article_sources SET webhook_url = NULL WHERE id = ?")
    .run(source.id);
  assert.deepEqual(await articles.dispatch(owner, source.id), {
    error: "Webhook URL が設定されていません",
    status: 400,
  });
  assert.equal(fetch.mock.callCount(), 2);
});

test("sourceNoteFilter matches the folder and any descendant path", () => {
  const filter = sourceNoteFilter("work");
  assert.match(filter.sql, /folder = \? OR \(folder >= \? AND folder < \?\)/);
  assert.deepEqual(filter.binds, ["work", "work/", "work0"]);
  const escaped = sourceNoteFilter("a_b");
  assert.deepEqual(escaped.binds, ["a_b", "a_b/", "a_b0"]);
});

test("escapeLikePattern escapes LIKE wildcards", () => {
  assert.equal(escapeLikePattern("work"), "work");
  assert.equal(escapeLikePattern("a_b%c\\d"), "a\\_b\\%c\\\\d");
});

test("isAllowedWebhookUrl allows https and local http", () => {
  assert.equal(
    isAllowedWebhookUrl("https://api.github.com/repos/org/repo/dispatches"),
    true,
  );
  assert.equal(isAllowedWebhookUrl("http://127.0.0.1:8787/hook"), true);
  assert.equal(isAllowedWebhookUrl("http://example.com/hook"), false);
  assert.equal(isAllowedWebhookUrl("not-a-url"), false);
});

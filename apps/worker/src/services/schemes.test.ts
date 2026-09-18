import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { type SessionUser, zettelStamp } from "@miyulabmd/shared";
import { upsertUserByEmail } from "../db/users.ts";
import { ensureFolderRow } from "./access.ts";
import { createNoteService } from "./notes.ts";
import {
  createSchemeChild,
  folderIdForSchemeId,
  jdAllocateId,
  jdListCategory,
  schemeGet,
  schemeNoteTitlePrefix,
  setFolderScheme,
  suggestSchemeChild,
  validateSchemeTree,
} from "./schemes.ts";

const MIGRATIONS = [
  "0001_init.sql",
  "0002_folders.sql",
  "0003_access_scopes.sql",
  "0004_folders_registry.sql",
  "0005_folder_ids.sql",
  "0006_article_sources.sql",
  "0007_user_root_folders.sql",
  "0008_split_link_and_public_scopes.sql",
  "0009_note_history.sql",
  "0010_note_links.sql",
  "0011_para_buckets.sql",
  "0012_naming_schemes.sql",
  "0013_medallion_layers.sql",
  "0014_notes_fts.sql",

  "0015_user_settings.sql",
  "0016_para_spaces.sql",
  "0017_medallion_sets_edit_lock.sql",
];

function applyMigrations(db: DatabaseSync): void {
  for (const migration of MIGRATIONS) {
    const sql = readFileSync(
      new URL(`../db/migrations/${migration}`, import.meta.url),
      "utf8",
    );
    db.exec(sql);
  }
}

type BoundStatement = {
  bind: (...values: unknown[]) => BoundStatement;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  first: <T = Record<string, unknown>>() => Promise<T | null>;
  run: () => Promise<{ success: true }>;
};

class StatementAdapter implements BoundStatement {
  private readonly db: DatabaseSync;
  private readonly query: string;
  private readonly binds: unknown[];

  constructor(db: DatabaseSync, query: string, binds: unknown[] = []) {
    this.db = db;
    this.query = query;
    this.binds = binds;
  }

  bind(...values: unknown[]): BoundStatement {
    return new StatementAdapter(this.db, this.query, values);
  }

  all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const rows = this.db.prepare(this.query).all(...this.binds);
    return Promise.resolve({ results: rows as T[] });
  }

  first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.db.prepare(this.query).get(...this.binds);
    return Promise.resolve((row as T | null) ?? null);
  }

  runSync(): { success: true } {
    this.db.prepare(this.query).run(...this.binds);
    return { success: true };
  }

  run(): Promise<{ success: true }> {
    return Promise.resolve(this.runSync());
  }
}

class D1DatabaseAdapter {
  private readonly db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  prepare(query: string): BoundStatement {
    return new StatementAdapter(this.db, query);
  }

  batch(statements: BoundStatement[]) {
    this.db.exec("BEGIN");
    try {
      const results = statements.map((statement) =>
        (statement as StatementAdapter).runSync(),
      );
      this.db.exec("COMMIT");
      return Promise.resolve(results);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

async function createEnv() {
  const sqlite = new DatabaseSync(":memory:");
  applyMigrations(sqlite);

  const env = {
    ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    ALLOW_ANONYMOUS: "false",
    ALLOW_ANONYMOUS_EDITS: "true",
    ALLOW_ANONYMOUS_VIEWS: "true",
    DB: new D1DatabaseAdapter(sqlite),
    DEFAULT_PERMISSION: "editable",
    DEV_AUTH: "false",
  } as unknown as Env;

  const owner = await upsertUserByEmail(env, "owner@example.com", "Owner");
  const other = await upsertUserByEmail(env, "other@example.com", "Other");
  await ensureFolderRow(env, owner.id, "");
  await ensureFolderRow(env, other.id, "");

  return { env, other, owner, sqlite };
}

function folderIdOf(sqlite: DatabaseSync, folder: string) {
  const row = sqlite
    .prepare("SELECT id FROM folders WHERE folder = ?")
    .get(folder) as { id: string } | undefined;
  return row?.id ?? null;
}

function rootIdOf(sqlite: DatabaseSync) {
  return folderIdOf(sqlite, "");
}

/** root に jd を設定し、「エリア→カテゴリ→ID」まで採番作成する。 */
async function buildJdPath(env: Env, owner: SessionUser, sqlite: DatabaseSync) {
  const rootId = rootIdOf(sqlite);
  assert.ok(rootId);
  assert.equal((await setFolderScheme(env, rootId, "jd", owner)).kind, "ok");
  const area = await createSchemeChild(env, rootId, { title: "仕事" }, owner);
  assert.equal(area.kind, "ok");
  if (area.kind !== "ok") {
    throw new Error("unreachable");
  }
  const category = await createSchemeChild(
    env,
    area.result.folder.id ?? "",
    { title: "経費" },
    owner,
  );
  assert.equal(category.kind, "ok");
  if (category.kind !== "ok") {
    throw new Error("unreachable");
  }
  return { area: area.result, category: category.result };
}

test("JD ルート→エリア→カテゴリ→ID を順に採番できる", async () => {
  const { env, owner, sqlite } = await createEnv();
  const { area, category } = await buildJdPath(env, owner, sqlite);

  assert.equal(area.schemeId, "10-19");
  assert.equal(area.name, "10-19 仕事");
  assert.equal(category.schemeId, "10");
  assert.equal(category.name, "10 経費");

  const id = await createSchemeChild(env, category.folder.id ?? "", {}, owner);
  assert.equal(id.kind, "ok");
  if (id.kind !== "ok") {
    return;
  }
  // .00–.10 は予約なので最初の自動採番は .11。
  assert.equal(id.result.schemeId, "10.11");
  assert.equal(id.result.name, "10.11 無題");
});

test("連続採番は一意で欠番を埋めない", async () => {
  const { env, owner, sqlite } = await createEnv();
  const { category } = await buildJdPath(env, owner, sqlite);
  const categoryId = category.folder.id ?? "";

  const first = await jdAllocateId(env, categoryId, owner);
  const second = await jdAllocateId(env, categoryId, owner);
  const third = await jdAllocateId(env, categoryId, owner);
  assert.equal(first.kind, "ok");
  assert.equal(second.kind, "ok");
  assert.equal(third.kind, "ok");
  if (first.kind !== "ok" || second.kind !== "ok" || third.kind !== "ok") {
    return;
  }
  assert.equal(first.result.schemeId, "10.11");
  assert.equal(second.result.schemeId, "10.12");
  assert.equal(third.result.schemeId, "10.13");
  // 採番だけして作成しなくても次は進む（欠番 10.11/10.12 は埋めない）。
  const created = await createSchemeChild(env, categoryId, {}, owner);
  assert.equal(created.kind, "ok");
  if (created.kind !== "ok") {
    return;
  }
  assert.equal(created.result.schemeId, "10.14");
});

test("採番はカテゴリローカル（別カテゴリは別カウンタ）", async () => {
  const { env, owner, sqlite } = await createEnv();
  const { area } = await buildJdPath(env, owner, sqlite);
  const areaId = area.folder.id ?? "";

  // buildJdPath でカテゴリ 10 は作成済みなので、ここでは 11 / 12 が採番される。
  const catA = await createSchemeChild(env, areaId, {}, owner);
  const catB = await createSchemeChild(env, areaId, {}, owner);
  assert.equal(catA.kind, "ok");
  assert.equal(catB.kind, "ok");
  if (catA.kind !== "ok" || catB.kind !== "ok") {
    return;
  }
  assert.equal(catA.result.schemeId, "11");
  assert.equal(catB.result.schemeId, "12");

  const idA = await createSchemeChild(
    env,
    catA.result.folder.id ?? "",
    {},
    owner,
  );
  const idB = await createSchemeChild(
    env,
    catB.result.folder.id ?? "",
    {},
    owner,
  );
  assert.equal(idA.kind, "ok");
  assert.equal(idB.kind, "ok");
  if (idA.kind !== "ok" || idB.kind !== "ok") {
    return;
  }
  assert.equal(idA.result.schemeId, "11.11");
  assert.equal(idB.result.schemeId, "12.11");
});

test("カテゴリの ID 上限（.99）に達したらエラー", async () => {
  const { env, owner, sqlite } = await createEnv();
  const { category } = await buildJdPath(env, owner, sqlite);
  const categoryId = category.folder.id ?? "";

  // カウンタを上限直前に進める。
  sqlite
    .prepare(
      "INSERT INTO id_counters (owner_id, scope, next_value) VALUES (?, ?, ?)",
    )
    .run(owner.id, "jd:id:10", 99);
  const okAlloc = await jdAllocateId(env, categoryId, owner);
  assert.equal(okAlloc.kind, "ok");
  if (okAlloc.kind !== "ok") {
    return;
  }
  assert.equal(okAlloc.result.schemeId, "10.99");

  const overflow = await jdAllocateId(env, categoryId, owner);
  assert.equal(overflow.kind, "invalid");
  if (overflow.kind === "invalid") {
    assert.equal(overflow.status, 409);
    assert.match(overflow.error, /上限/);
  }
});

test("エリアは 10 件・カテゴリはエリアあたり 10 件で上限", async () => {
  const { env, owner, sqlite } = await createEnv();
  const rootId = rootIdOf(sqlite);
  assert.ok(rootId);
  await setFolderScheme(env, rootId, "jd", owner);

  sqlite
    .prepare(
      "INSERT INTO id_counters (owner_id, scope, next_value) VALUES (?, ?, ?)",
    )
    .run(owner.id, "jd:area", 9);
  const last = await jdAllocateId(env, rootId, owner);
  assert.equal(last.kind, "ok");
  if (last.kind !== "ok") {
    return;
  }
  assert.equal(last.result.schemeId, "90-99");
  const overflow = await jdAllocateId(env, rootId, owner);
  assert.equal(overflow.kind, "invalid");
});

test("明示 ID で採番でき、重複は 409", async () => {
  const { env, owner, sqlite } = await createEnv();
  const { category } = await buildJdPath(env, owner, sqlite);
  const categoryId = category.folder.id ?? "";

  const created = await createSchemeChild(
    env,
    categoryId,
    { schemeId: "10.42", title: "旅費" },
    owner,
  );
  assert.equal(created.kind, "ok");
  if (created.kind !== "ok") {
    return;
  }
  assert.equal(created.result.name, "10.42 旅費");

  const dup = await createSchemeChild(
    env,
    categoryId,
    { schemeId: "10.42" },
    owner,
  );
  assert.equal(dup.kind, "invalid");
  if (dup.kind === "invalid") {
    assert.equal(dup.status, 409);
  }

  // 別カテゴリの ID をこのカテゴリに作るのは不可。
  const wrongCat = await createSchemeChild(
    env,
    categoryId,
    { schemeId: "22.11" },
    owner,
  );
  assert.equal(wrongCat.kind, "invalid");
});

test("jd_get / scheme_get で ID からフォルダを引ける", async () => {
  const { env, owner, sqlite } = await createEnv();
  const { category } = await buildJdPath(env, owner, sqlite);
  const created = await createSchemeChild(
    env,
    category.folder.id ?? "",
    { title: "領収書" },
    owner,
  );
  assert.equal(created.kind, "ok");
  if (created.kind !== "ok") {
    return;
  }

  const resolved = await schemeGet(env, "10.11", owner);
  assert.equal(resolved.kind, "ok");
  if (resolved.kind !== "ok") {
    return;
  }
  assert.equal(resolved.result.folder.id, created.result.folder.id);
  assert.equal(resolved.result.folder.schemeId, "10.11");
  assert.equal(resolved.result.folder.name, "10.11 領収書");

  const missing = await schemeGet(env, "55.55", owner);
  assert.equal(missing.kind, "not_found");
});

test("jd_list_category は数値順で返す", async () => {
  const { env, owner, sqlite } = await createEnv();
  const { category } = await buildJdPath(env, owner, sqlite);
  const categoryId = category.folder.id ?? "";

  await createSchemeChild(env, categoryId, { schemeId: "10.09" }, owner);
  await createSchemeChild(env, categoryId, { schemeId: "10.20" }, owner);
  await createSchemeChild(env, categoryId, { schemeId: "10.05" }, owner);

  const listed = await jdListCategory(env, categoryId, owner);
  assert.equal(listed.kind, "ok");
  if (listed.kind !== "ok") {
    return;
  }
  assert.equal(listed.result.level, "id");
  assert.deepEqual(
    listed.result.entries.map((entry) => entry.schemeId),
    ["10.05", "10.09", "10.20"],
  );
});

test("jd_validate_tree が命名逸脱・孤立 ID・予約範囲を報告する", async () => {
  const { env, owner, sqlite } = await createEnv();
  const { category } = await buildJdPath(env, owner, sqlite);
  const categoryId = category.folder.id ?? "";
  await createSchemeChild(env, categoryId, { schemeId: "10.05" }, owner);

  // 1) 命名逸脱: 正しい ID だがフォルダ名が違う。
  sqlite
    .prepare("UPDATE folders SET folder = ? WHERE scheme_id = ?")
    .run("10-19 仕事/10 経費/10.05 改名済み", "10.05");

  // 2) 孤立 ID: 規則なしフォルダ直下に JD っぽい scheme_id。
  sqlite
    .prepare(
      `INSERT INTO folders (id, owner_id, folder, scheme_id, scheme_title, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run("orphan-1", owner.id, "10.77 迷子", "10.77", "迷子", Date.now());

  const result = await validateSchemeTree(env, owner);
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") {
    return;
  }
  const codes = result.result.issues.map((issue) => issue.code).sort();
  assert.ok(codes.includes("name_mismatch"));
  assert.ok(codes.includes("wrong_parent"));
  assert.ok(codes.includes("reserved"));
});

test("scheme なしフォルダは従来通り（suggestion なし・自由名）", async () => {
  const { env, owner, sqlite } = await createEnv();
  const rootId = rootIdOf(sqlite);
  assert.ok(rootId);
  const suggested = await suggestSchemeChild(env, rootId, owner);
  assert.equal(suggested.kind, "ok");
  if (suggested.kind !== "ok") {
    return;
  }
  assert.equal(suggested.result.suggestion, null);

  const created = await createSchemeChild(env, rootId, {}, owner);
  assert.equal(created.kind, "invalid");
});

test("zettel 規則は YYYYMMDDHHmm の ID を採番する", async () => {
  const { env, owner, sqlite } = await createEnv();
  const rootId = rootIdOf(sqlite);
  assert.ok(rootId);
  await setFolderScheme(env, rootId, "zettel", owner);

  const suggested = await suggestSchemeChild(env, rootId, owner);
  assert.equal(suggested.kind, "ok");
  if (suggested.kind !== "ok") {
    return;
  }
  assert.equal(suggested.result.suggestion?.scheme, "zettel");
  assert.match(suggested.result.suggestion?.schemeId ?? "", /^\d{12}$/);

  const created = await createSchemeChild(
    env,
    rootId,
    { title: "メモ" },
    owner,
  );
  assert.equal(created.kind, "ok");
  if (created.kind !== "ok") {
    return;
  }
  assert.match(created.result.schemeId, /^\d{12}$/);
  assert.match(created.result.name, /^\d{12} メモ$/);

  const resolved = await schemeGet(env, created.result.schemeId, owner);
  assert.equal(resolved.kind, "ok");
});

test("zettel フォルダではノートタイトルにタイムスタンプが付く", async () => {
  const { env, owner, sqlite } = await createEnv();
  const rootId = rootIdOf(sqlite);
  assert.ok(rootId);
  await setFolderScheme(env, rootId, "zettel", owner);

  const now = Date.UTC(2026, 8, 17, 12, 30);
  const prefix = await schemeNoteTitlePrefix(env, owner.id, "", now);
  assert.equal(prefix, `${zettelStamp(now)} `);

  // jd フォルダ配下ではプレフィックスなし。
  await setFolderScheme(env, rootId, "jd", owner);
  const jdPrefix = await schemeNoteTitlePrefix(env, owner.id, "", now);
  assert.equal(jdPrefix, null);
});

test("folderIdForSchemeId は scheme_id をフォルダ UUID に解決する", async () => {
  const { env, other, owner, sqlite } = await createEnv();
  const { category } = await buildJdPath(env, owner, sqlite);
  const item = await createSchemeChild(
    env,
    category.folder.id ?? "",
    { title: "領収書" },
    owner,
  );
  assert.equal(item.kind, "ok");
  if (item.kind !== "ok") {
    return;
  }

  const resolved = await folderIdForSchemeId(env, owner.id, "10.11");
  assert.equal(resolved, item.result.folder.id);
  // 未存在 ID・他人スコープは null。
  assert.equal(await folderIdForSchemeId(env, owner.id, "99.99"), null);
  assert.equal(await folderIdForSchemeId(env, other.id, "10.11"), null);
  assert.equal(await folderIdForSchemeId(env, owner.id, "  "), null);
});

test("ノートの get/create は所属フォルダの scheme_id を返す", async () => {
  const { env, owner, sqlite } = await createEnv();
  const { category } = await buildJdPath(env, owner, sqlite);
  const item = await createSchemeChild(
    env,
    category.folder.id ?? "",
    { title: "領収書" },
    owner,
  );
  assert.equal(item.kind, "ok");
  if (item.kind !== "ok") {
    return;
  }

  const notes = createNoteService(env);
  const created = await notes.create(owner, {
    folderId: item.result.folder.id ?? undefined,
    markdown: "# レシート",
  });
  assert.ok(!("error" in created));
  if ("error" in created) {
    return;
  }
  assert.equal(created.folderSchemeId, "10.11");
  assert.equal(created.folderSchemeTitle, "領収書");

  const got = await notes.get(created.id, owner);
  assert.equal(got.kind, "ok");
  if (got.kind !== "ok") {
    return;
  }
  assert.equal(got.note.folderSchemeId, "10.11");

  // 規則なしフォルダのノートは null。
  const plain = await notes.create(owner, { markdown: "# 雑多" });
  assert.ok(!("error" in plain));
  if ("error" in plain) {
    return;
  }
  assert.equal(plain.folderSchemeId, null);
});

test("他人のフォルダには規則を設定・採番できない", async () => {
  const { env, other, owner, sqlite } = await createEnv();
  const rootId = rootIdOf(sqlite);
  assert.ok(rootId);

  const deniedScheme = await setFolderScheme(env, rootId, "jd", other);
  assert.equal(deniedScheme.kind, "denied");
  if (deniedScheme.kind === "denied") {
    assert.equal(deniedScheme.status, 403);
  }

  await setFolderScheme(env, rootId, "jd", owner);
  const deniedCreate = await createSchemeChild(env, rootId, {}, other);
  assert.equal(deniedCreate.kind, "denied");

  // 他人のスコープの ID は引けない。
  await createSchemeChild(env, rootId, { schemeId: "10-19" }, owner);
  const resolved = await schemeGet(env, "10-19", other);
  assert.equal(resolved.kind, "not_found");
});

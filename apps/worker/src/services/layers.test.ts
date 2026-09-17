import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { SessionUser } from "@miyulabmd/shared";
import { upsertUserByEmail } from "../db/users.ts";
import { ensureFolderRow } from "./access.ts";
import {
  demoteNote,
  listLayerEvents,
  listNotesByLayer,
  promoteNote,
  setNoteLayer,
  unlockGoldForEdit,
} from "./layers.ts";
import { createNoteService } from "./notes.ts";

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

/** 昇格ゲートを満たすノート（タイトル+本文+解決済みリンク+H2）。 */
async function createPromotableNote(
  env: Env,
  owner: SessionUser,
  markdown = "# まとめ\n\n## 概要\n\n[[対象ノート]] へのリンク本文。\n",
) {
  const notes = createNoteService(env);
  await notes.create(owner, { markdown: "# 対象ノート\n\nリンク先。" });
  const created = await notes.create(owner, { markdown });
  assert.ok(!("error" in created));
  if ("error" in created) {
    throw new Error("unreachable");
  }
  return { created, notes };
}

test("新規ノートは bronze 層でロック無し", async () => {
  const { env, owner } = await createEnv();
  const notes = createNoteService(env);
  const created = await notes.create(owner, { markdown: "# n\n\nbody" });
  assert.ok(!("error" in created));
  if ("error" in created) {
    return;
  }
  assert.equal(created.layer, "bronze");
  assert.equal(created.goldLocked, false);
  assert.equal(created.goldUnlockedUntil, null);
});

test("promote はゲート失敗を機械可読で返す", async () => {
  const { env, owner } = await createEnv();
  const notes = createNoteService(env);
  const created = await notes.create(owner, { markdown: "# 無題\n" });
  assert.ok(!("error" in created));
  if ("error" in created) {
    return;
  }

  const result = await promoteNote(env, created.id, true, owner);
  assert.equal(result.kind, "gates");
  if (result.kind !== "gates") {
    return;
  }
  const codes = result.failures.map((f) => f.code);
  assert.ok(codes.includes("missing_title"));
  assert.ok(codes.includes("empty_body"));
  assert.ok(codes.includes("no_links"));
  // silver 昇格では no_headings/broken_links は要求しない。
  assert.ok(!codes.includes("no_headings"));
  assert.ok(!codes.includes("needs_confirm"));
});

test("promote bronze→silver→gold と監査イベント", async () => {
  const { env, owner } = await createEnv();
  const { created } = await createPromotableNote(env, owner);

  const silver = await promoteNote(env, created.id, undefined, owner);
  assert.equal(silver.kind, "ok");
  if (silver.kind !== "ok") {
    return;
  }
  assert.equal(silver.result.note.layer, "silver");

  // confirm 無しの gold 昇格は needs_confirm。
  const noConfirm = await promoteNote(env, created.id, undefined, owner);
  assert.equal(noConfirm.kind, "gates");
  if (noConfirm.kind === "gates") {
    assert.ok(noConfirm.failures.some((f) => f.code === "needs_confirm"));
  }

  const gold = await promoteNote(env, created.id, true, owner);
  assert.equal(gold.kind, "ok");
  if (gold.kind !== "ok") {
    return;
  }
  assert.equal(gold.result.note.layer, "gold");
  assert.equal(gold.result.note.goldLocked, true);

  const events = await listLayerEvents(env, created.id, owner);
  assert.equal(events.kind, "ok");
  if (events.kind !== "ok") {
    return;
  }
  assert.deepEqual(
    events.result.events.map((e) => [e.fromLayer, e.toLayer]),
    [
      ["silver", "gold"],
      ["bronze", "silver"],
    ],
  );
});

test("gold ノートは編集拒否、unlock 中のみ可、期限切れで再ロック", async () => {
  const { env, owner, sqlite } = await createEnv();
  const { created, notes } = await createPromotableNote(env, owner);
  await promoteNote(env, created.id, undefined, owner);
  const gold = await promoteNote(env, created.id, true, owner);
  assert.equal(gold.kind, "ok");

  // ロック中は updateMarkdown が 403。
  const deniedEdit = await notes.updateMarkdown(
    created.id,
    owner,
    "# まとめ\n\n## 概要\n\n書き換え [[対象ノート]]。",
  );
  assert.equal(deniedEdit.kind, "denied");
  if (deniedEdit.kind === "denied") {
    assert.equal(deniedEdit.status, 403);
  }

  // unlock → 編集可。
  const unlocked = await unlockGoldForEdit(env, created.id, 30, owner);
  assert.equal(unlocked.kind, "ok");
  if (unlocked.kind !== "ok") {
    return;
  }
  assert.ok(unlocked.result.unlockedUntil > Date.now());
  const allowed = await notes.updateMarkdown(
    created.id,
    owner,
    "# まとめ\n\n## 概要\n\n書き換え [[対象ノート]]。",
  );
  assert.equal(allowed.kind, "ok");

  // 期限切れ（過去に巻き戻す）→ 再び 403。
  sqlite
    .prepare("UPDATE notes SET gold_unlocked_until = ? WHERE id = ?")
    .run(Date.now() - 1000, created.id);
  const relocked = await notes.updateMarkdown(
    created.id,
    owner,
    "# まとめ\n\n## 概要\n\nさらに書き換え。",
  );
  assert.equal(relocked.kind, "denied");
});

test("demote は理由必須で unlock をリセット", async () => {
  const { env, owner } = await createEnv();
  const { created } = await createPromotableNote(env, owner);
  await promoteNote(env, created.id, undefined, owner);
  await promoteNote(env, created.id, true, owner);
  await unlockGoldForEdit(env, created.id, 30, owner);

  const noReason = await demoteNote(env, created.id, null, "silver", owner);
  assert.equal(noReason.kind, "invalid");

  const demoted = await demoteNote(
    env,
    created.id,
    "内容が古くなった",
    "silver",
    owner,
  );
  assert.equal(demoted.kind, "ok");
  if (demoted.kind !== "ok") {
    return;
  }
  assert.equal(demoted.result.note.layer, "silver");
  assert.equal(demoted.result.note.goldUnlockedUntil, null);
});

test("set_note_layer は任意遷移・他人は不可、list_notes_by_layer で絞り込み", async () => {
  const { env, other, owner } = await createEnv();
  const { created, notes } = await createPromotableNote(env, owner);

  const direct = await setNoteLayer(env, created.id, "gold", "整理済み", owner);
  assert.equal(direct.kind, "ok");
  if (direct.kind === "ok") {
    assert.equal(direct.result.note.layer, "gold");
  }

  const denied = await setNoteLayer(env, created.id, "silver", null, other);
  assert.equal(denied.kind, "not_found");

  const plain = await notes.create(owner, { markdown: "# 雑多\n\nbody" });
  assert.ok(!("error" in plain));

  const golds = await listNotesByLayer(env, owner, "gold");
  assert.equal(golds.kind, "ok");
  if (golds.kind !== "ok") {
    return;
  }
  assert.deepEqual(
    golds.result.notes.map((n) => n.id),
    [created.id],
  );
  const bronzes = await listNotesByLayer(env, owner, "bronze");
  assert.equal(bronzes.kind, "ok");
  if (bronzes.kind === "ok") {
    assert.ok(bronzes.result.notes.some((n) => n.id === plain.id));
    assert.ok(!bronzes.result.notes.some((n) => n.id === created.id));
  }
});

test("promote は gold 超過と不正 layer を拒否", async () => {
  const { env, owner } = await createEnv();
  const { created } = await createPromotableNote(env, owner);
  await setNoteLayer(env, created.id, "gold", null, owner);

  const beyond = await promoteNote(env, created.id, true, owner);
  assert.equal(beyond.kind, "invalid");

  const badLayer = await setNoteLayer(
    env,
    created.id,
    "platinum" as never,
    null,
    owner,
  );
  assert.equal(badLayer.kind, "invalid");
});

test("broken link があると gold 昇格できない", async () => {
  const { env, owner } = await createEnv();
  const notes = createNoteService(env);
  // 未解決リンクを含むノート（リンク先が存在しない → missing）。
  const created = await notes.create(owner, {
    markdown: "# まとめ\n\n## 概要\n\n[[存在しないノート]] へのリンク。",
  });
  assert.ok(!("error" in created));
  if ("error" in created) {
    return;
  }
  const silver = await promoteNote(env, created.id, undefined, owner);
  assert.equal(silver.kind, "ok");

  const gold = await promoteNote(env, created.id, true, owner);
  assert.equal(gold.kind, "gates");
  if (gold.kind === "gates") {
    assert.ok(gold.failures.some((f) => f.code === "broken_links"));
  }
});

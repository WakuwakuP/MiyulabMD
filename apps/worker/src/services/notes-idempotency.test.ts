import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { upsertUserByEmail } from "../db/users.ts";
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
  "0010_note_create_requests.sql",
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

  run(): Promise<{ success: true }> {
    this.db.prepare(this.query).run(...this.binds);
    return Promise.resolve({ success: true });
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

  async batch(statements: BoundStatement[]): Promise<{ success: true }[]> {
    this.db.exec("BEGIN");
    try {
      for (const statement of statements) {
        await statement.run();
      }
      this.db.exec("COMMIT");
      return statements.map(() => ({ success: true as const }));
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function draftId(suffix: string): string {
  return `local-00000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
}

async function createTestEnv(shortIdSequence?: string[]) {
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
    TEST_SHORT_ID_SEQUENCE: shortIdSequence,
  } as unknown as Env;
  const owner = await upsertUserByEmail(env, "owner@example.com", "Owner");
  return { env, owner, sqlite };
}

test("idempotent create replays same note without mutating content", async (t) => {
  const { env, owner, sqlite } = await createTestEnv();
  t.after(() => sqlite.close());
  const notes = createNoteService(env);
  const clientDraftId = draftId("000000000001");
  const input = {
    clientDraftId,
    draftOwnerId: owner.id,
    markdown: "# Replay me\n",
    title: "Replay me",
  };

  const first = await notes.create(owner, input);
  assert.equal(first.kind, "created");
  if (first.kind !== "created") {
    return;
  }

  sqlite
    .prepare("UPDATE notes SET markdown_snapshot = ?, title = ? WHERE id = ?")
    .run("# mutated\n", "mutated", first.note.id);
  const beforeReplay = sqlite
    .prepare(
      "SELECT markdown_snapshot, title, updated_at FROM notes WHERE id = ?",
    )
    .get(first.note.id) as {
    markdown_snapshot: string;
    title: string;
    updated_at: number;
  };

  const second = await notes.create(owner, input);
  assert.equal(second.kind, "replayed");
  if (second.kind !== "replayed") {
    return;
  }

  assert.equal(second.note.id, first.note.id);
  assert.equal(second.note.markdown, "# mutated\n");
  assert.equal(second.note.title, "mutated");

  const afterReplay = sqlite
    .prepare(
      "SELECT markdown_snapshot, title, updated_at FROM notes WHERE id = ?",
    )
    .get(first.note.id) as {
    markdown_snapshot: string;
    title: string;
    updated_at: number;
  };
  assert.deepEqual(afterReplay, beforeReplay);
});

test("idempotent create rejects conflicting payload hash", async (t) => {
  const { env, owner, sqlite } = await createTestEnv();
  t.after(() => sqlite.close());
  const notes = createNoteService(env);
  const clientDraftId = draftId("000000000002");
  const created = await notes.create(owner, {
    clientDraftId,
    draftOwnerId: owner.id,
    markdown: "# One\n",
  });
  assert.equal(created.kind, "created");

  const conflict = await notes.create(owner, {
    clientDraftId,
    draftOwnerId: owner.id,
    markdown: "# Two\n",
  });
  assert.equal(conflict.kind, "error");
  if (conflict.kind !== "error") {
    return;
  }
  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, "idempotency_conflict");
});

test("draft owner mismatch and partial keys are rejected", async (t) => {
  const { env, owner, sqlite } = await createTestEnv();
  t.after(() => sqlite.close());
  const notes = createNoteService(env);
  const other = await upsertUserByEmail(env, "other@example.com", "Other");

  const mismatch = await notes.create(owner, {
    clientDraftId: draftId("000000000003"),
    draftOwnerId: other.id,
    markdown: "# x\n",
  });
  assert.equal(mismatch.kind, "error");
  if (mismatch.kind === "error") {
    assert.equal(mismatch.status, 409);
    assert.equal(mismatch.code, "owner_mismatch");
  }

  const partial = await notes.create(owner, {
    clientDraftId: draftId("000000000004"),
  });
  assert.equal(partial.kind, "error");
  if (partial.kind === "error") {
    assert.equal(partial.status, 400);
  }
});

test("deleted mapping returns 410 on replay", async (t) => {
  const { env, owner, sqlite } = await createTestEnv();
  t.after(() => sqlite.close());
  const notes = createNoteService(env);
  const clientDraftId = draftId("000000000005");
  const input = {
    clientDraftId,
    draftOwnerId: owner.id,
    markdown: "# Gone\n",
  };
  const created = await notes.create(owner, input);
  assert.equal(created.kind, "created");
  if (created.kind !== "created") {
    return;
  }

  await notes.remove(created.note.id, owner);
  const replay = await notes.create(owner, input);
  assert.equal(replay.kind, "error");
  if (replay.kind === "error") {
    assert.equal(replay.status, 410);
    assert.equal(replay.code, "draft_deleted");
  }
});

test("legacy create without draft keys still works", async (t) => {
  const { env, owner, sqlite } = await createTestEnv();
  t.after(() => sqlite.close());
  const notes = createNoteService(env);
  const created = await notes.create(owner, { markdown: "# Legacy\n" });
  assert.equal(created.kind, "created");
  if (created.kind !== "created") {
    return;
  }
  assert.match(created.note.id, /^[0-9a-f-]{36}$/i);
  assert.equal(created.note.markdown, "# Legacy\n");
});

test("short_id unique collision retries leave a single mapped note", async (t) => {
  const collision = "COLLID01";
  const { env, owner, sqlite } = await createTestEnv([collision, "UNIQUE01"]);
  t.after(() => sqlite.close());
  const notes = createNoteService(env);
  const now = Date.now();
  sqlite
    .prepare(
      `INSERT INTO notes (
         id, short_id, alias, owner_id, title, folder, permission,
         read_scope, write_scope, markdown_snapshot, snapshot_updated_at,
         created_at, updated_at
       ) VALUES (?, ?, NULL, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      collision,
      owner.id,
      "blocker",
      "",
      "private",
      "",
      now,
      now,
      now,
    );

  const clientDraftId = draftId("000000000006");
  const created = await notes.create(owner, {
    clientDraftId,
    draftOwnerId: owner.id,
    markdown: "# Collision\n",
  });
  assert.equal(created.kind, "created");
  if (created.kind !== "created") {
    return;
  }

  const replay = await notes.create(owner, {
    clientDraftId,
    draftOwnerId: owner.id,
    markdown: "# Collision\n",
  });
  assert.equal(replay.kind, "replayed");
  if (replay.kind !== "replayed") {
    return;
  }
  assert.equal(replay.note.id, created.note.id);

  const mappingCount = sqlite
    .prepare(
      "SELECT COUNT(*) AS count FROM note_create_requests WHERE client_draft_id = ?",
    )
    .get(clientDraftId) as { count: number };
  assert.equal(mappingCount.count, 1);
});

test("prepareConditionalMarkdownUpdate validates mapping and owner", async (t) => {
  const { env, owner, sqlite } = await createTestEnv();
  t.after(() => sqlite.close());
  const notes = createNoteService(env);
  const clientDraftId = draftId("000000000007");
  const created = await notes.create(owner, {
    clientDraftId,
    draftOwnerId: owner.id,
    markdown: "# Draft\n",
  });
  assert.equal(created.kind, "created");
  if (created.kind !== "created") {
    return;
  }

  const ok = await notes.prepareConditionalMarkdownUpdate(
    created.note.id,
    owner,
    {
      clientDraftId,
      draftOwnerId: owner.id,
      expectedMarkdown: "# Draft\n",
      markdown: "# Draft v2\n",
    },
  );
  assert.equal(ok.kind, "ok");
  if (ok.kind !== "ok") {
    return;
  }
  assert.equal(ok.noteId, created.note.id);
  assert.equal(ok.markdown, "# Draft v2\n");

  const other = await upsertUserByEmail(env, "other2@example.com", "Other");
  const ownerMismatch = await notes.prepareConditionalMarkdownUpdate(
    created.note.id,
    owner,
    {
      clientDraftId,
      draftOwnerId: other.id,
      expectedMarkdown: "# Draft\n",
      markdown: "# Draft v2\n",
    },
  );
  assert.equal(ownerMismatch.kind, "conflict");
  if (ownerMismatch.kind === "conflict") {
    assert.equal(ownerMismatch.code, "owner_mismatch");
  }

  const wrongNote = await notes.create(owner, {
    markdown: "# Other note\n",
  });
  assert.equal(wrongNote.kind, "created");
  if (wrongNote.kind !== "created") {
    return;
  }

  const mappingMismatch = await notes.prepareConditionalMarkdownUpdate(
    wrongNote.note.id,
    owner,
    {
      clientDraftId,
      draftOwnerId: owner.id,
      expectedMarkdown: "# Draft\n",
      markdown: "# Draft v2\n",
    },
  );
  assert.equal(mappingMismatch.kind, "conflict");
  if (mappingMismatch.kind === "conflict") {
    assert.equal(mappingMismatch.code, "mapping_mismatch");
  }
});

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { upsertUserByEmail } from "../db/users.ts";
import { ensureFolderRow, parentFolderPath } from "./access.ts";
import { moveFolder, moveFolderContents, moveNotes } from "./move.ts";
import { createNoteService } from "./notes.ts";

type WriteHook = (statements: StatementAdapter[]) => void;

class StatementAdapter {
  readonly adapter: D1DatabaseAdapter;
  readonly query: string;
  readonly binds: unknown[];

  constructor(
    adapter: D1DatabaseAdapter,
    query: string,
    binds: unknown[] = [],
  ) {
    this.adapter = adapter;
    this.query = query;
    this.binds = binds;
  }

  bind(...values: unknown[]): StatementAdapter {
    return new StatementAdapter(this.adapter, this.query, values);
  }

  all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const rows = this.adapter.sqlite.prepare(this.query).all(...this.binds);
    return Promise.resolve({ results: rows as T[] });
  }

  first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.adapter.sqlite.prepare(this.query).get(...this.binds);
    return Promise.resolve((row as T | null) ?? null);
  }

  runSync() {
    const result = this.adapter.sqlite.prepare(this.query).run(...this.binds);
    return { meta: { changes: Number(result.changes) }, success: true };
  }

  run() {
    this.adapter.beforeWrite?.([this]);
    const result = this.runSync();
    this.adapter.afterWrite?.([this]);
    return Promise.resolve(result);
  }
}

/** Hooks represent another request and can interleave only outside a batch. */
class D1DatabaseAdapter {
  readonly sqlite: DatabaseSync;
  beforeWrite?: WriteHook;
  afterWrite?: WriteHook;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
  }

  prepare(query: string): StatementAdapter {
    return new StatementAdapter(this, query);
  }

  batch(statements: StatementAdapter[]) {
    this.beforeWrite?.(statements);
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement) => statement.runSync());
      this.sqlite.exec("COMMIT");
      this.afterWrite?.(statements);
      return Promise.resolve(results);
    } catch (error) {
      if (this.sqlite.isTransaction) {
        this.sqlite.exec("ROLLBACK");
      }
      throw error;
    }
  }
}

async function createEnv() {
  const sqlite = new DatabaseSync(":memory:");
  const migrations = new URL("../db/migrations/", import.meta.url);
  for (const migration of readdirSync(migrations)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    sqlite.exec(readFileSync(new URL(migration, migrations), "utf8"));
  }
  const d1 = new D1DatabaseAdapter(sqlite);
  const env = {
    ALLOW_ANONYMOUS: "false",
    ALLOW_ANONYMOUS_EDITS: "true",
    ALLOW_ANONYMOUS_VIEWS: "true",
    DB: d1,
    DEV_AUTH: "false",
  } as unknown as Env;
  const owner = await upsertUserByEmail(env, "owner@example.com", "Owner");
  return { d1, env, owner, sqlite };
}

function folderId(sqlite: DatabaseSync, ownerId: string, path: string) {
  const row = sqlite
    .prepare("SELECT id FROM folders WHERE owner_id = ? AND folder = ?")
    .get(ownerId, path) as { id: string } | undefined;
  return row?.id;
}

function assertRegisteredPaths(sqlite: DatabaseSync) {
  const orphanNotes = sqlite
    .prepare(
      `SELECT n.id FROM notes n LEFT JOIN folders f
       ON f.owner_id = n.owner_id AND f.folder = n.folder WHERE f.id IS NULL`,
    )
    .all();
  assert.deepEqual(orphanNotes, [], "note paths must exist at every commit");
  const folders = sqlite
    .prepare("SELECT owner_id, folder FROM folders WHERE folder != ''")
    .all() as { owner_id: string; folder: string }[];
  for (const folder of folders) {
    assert.ok(
      folderId(sqlite, folder.owner_id, parentFolderPath(folder.folder)),
      `missing parent for ${folder.folder}`,
    );
  }
}

/** Simulate the emptiness check and delete as a single SQL statement. */
function deleteIfEmpty(sqlite: DatabaseSync, ownerId: string, folder: string) {
  return Number(
    sqlite
      .prepare(
        `DELETE FROM folders AS f WHERE owner_id = ? AND folder = ?
         AND NOT EXISTS (
           SELECT 1 FROM notes n WHERE n.owner_id = f.owner_id
           AND (n.folder = f.folder OR instr(n.folder, f.folder || '/') = 1)
         )
         AND NOT EXISTS (
           SELECT 1 FROM folders c WHERE c.owner_id = f.owner_id
           AND instr(c.folder, f.folder || '/') = 1
         )`,
      )
      .run(ownerId, folder).changes,
  );
}

function deleteBeforeMutation(
  d1: D1DatabaseAdapter,
  ownerId: string,
  paths: string[],
  mutation: RegExp,
) {
  let deletions = 0;
  d1.beforeWrite = (statements) => {
    if (!statements.some((statement) => mutation.test(statement.query))) {
      return;
    }
    d1.beforeWrite = undefined;
    for (const path of paths) {
      deletions += deleteIfEmpty(d1.sqlite, ownerId, path);
    }
  };
  d1.afterWrite = (statements) => {
    assertRegisteredPaths(d1.sqlite);
    if (statements.some((statement) => mutation.test(statement.query))) {
      for (const path of paths) {
        assert.equal(
          deleteIfEmpty(d1.sqlite, ownerId, path),
          0,
          `the committed write must block deletion of ${path}`,
        );
      }
    }
  };
  return () => assert.equal(deletions, paths.length);
}

test("folder creation recreates a concurrently deleted parent atomically", async (t) => {
  const { d1, env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());
  await ensureFolderRow(env, owner.id, "Parent");
  const assertDeleted = deleteBeforeMutation(
    d1,
    owner.id,
    ["Parent"],
    /INSERT INTO folders/,
  );
  const childId = await ensureFolderRow(env, owner.id, "Parent/Child");
  assertDeleted();
  assert.equal(childId, folderId(sqlite, owner.id, "Parent/Child"));
  assertRegisteredPaths(sqlite);
});

for (const byId of [false, true]) {
  test(`note creation survives empty-folder deletion (byId=${byId})`, async (t) => {
    const { d1, env, owner, sqlite } = await createEnv();
    t.after(() => sqlite.close());
    const oldId = await ensureFolderRow(env, owner.id, "Parent/Dest");
    assert.ok(oldId);
    const assertDeleted = deleteBeforeMutation(
      d1,
      owner.id,
      ["Parent/Dest", "Parent"],
      /INSERT INTO notes/,
    );
    const note = await createNoteService(env).create(owner, {
      ...(byId ? { folderId: oldId } : { folder: "Parent/Dest" }),
      markdown: "# Race",
    });
    assertDeleted();
    assert.ok(!("error" in note));
    assert.equal(note.folderId, folderId(sqlite, owner.id, "Parent/Dest"));
    assert.notEqual(note.folderId, oldId);
    assert.equal(deleteIfEmpty(sqlite, owner.id, "Parent/Dest"), 0);
  });
}

test("metadata folder changes register destination ancestors in the update batch", async (t) => {
  const { d1, env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());
  const notes = createNoteService(env);
  const note = await notes.create(owner, { folder: "Source", markdown: "# N" });
  assert.ok(!("error" in note));
  await ensureFolderRow(env, owner.id, "Parent/Dest");
  const assertDeleted = deleteBeforeMutation(
    d1,
    owner.id,
    ["Parent/Dest", "Parent"],
    /UPDATE notes\s+SET title/,
  );
  const result = await notes.updateMeta(note.id, owner, {
    folder: "Parent/Dest",
  });
  assertDeleted();
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") {
    assert.equal(
      result.note.folderId,
      folderId(sqlite, owner.id, "Parent/Dest"),
    );
  }
  assert.equal(deleteIfEmpty(sqlite, owner.id, "Parent/Dest"), 0);
});

for (const contents of [false, true]) {
  test(`note moves return the recreated destination UUID (contents=${contents})`, async (t) => {
    const { d1, env, owner, sqlite } = await createEnv();
    t.after(() => sqlite.close());
    const note = await createNoteService(env).create(owner, {
      folder: "Source",
      markdown: "# N",
    });
    assert.ok(!("error" in note));
    const sourceId = folderId(sqlite, owner.id, "Source");
    const oldId = await ensureFolderRow(env, owner.id, "Parent/Dest");
    assert.ok(sourceId && oldId);
    const assertDeleted = deleteBeforeMutation(
      d1,
      owner.id,
      ["Parent/Dest", "Parent"],
      /UPDATE notes SET folder/,
    );
    const result = contents
      ? await moveFolderContents(env, sourceId, { destFolderId: oldId }, owner)
      : await moveNotes(
          env,
          { destFolderId: oldId, noteIds: [note.id] },
          owner,
        );
    assertDeleted();
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") {
      assert.equal(result.result.moved, 1);
      assert.equal(
        result.result.destFolderId,
        folderId(sqlite, owner.id, "Parent/Dest"),
      );
      assert.notEqual(result.result.destFolderId, oldId);
    }
    assert.equal(deleteIfEmpty(sqlite, owner.id, "Parent/Dest"), 0);
  });
}

for (const contents of [false, true]) {
  test(`subtree moves preserve UUIDs and register deleted ancestors (contents=${contents})`, async (t) => {
    const { d1, env, owner, sqlite } = await createEnv();
    t.after(() => sqlite.close());
    const note = await createNoteService(env).create(owner, {
      folder: "Source/Child",
      markdown: "# N",
    });
    assert.ok(!("error" in note));
    const sourceId = folderId(sqlite, owner.id, "Source");
    const childId = folderId(sqlite, owner.id, "Source/Child");
    const oldId = await ensureFolderRow(env, owner.id, "Parent/Dest");
    assert.ok(sourceId && childId && oldId);
    const assertDeleted = deleteBeforeMutation(
      d1,
      owner.id,
      ["Parent/Dest", "Parent"],
      /UPDATE folders SET/,
    );
    const result = contents
      ? await moveFolderContents(
          env,
          sourceId,
          { destFolderId: oldId, includeSubfolders: true },
          owner,
        )
      : await moveFolder(env, childId, { destFolderId: oldId }, owner);
    assertDeleted();
    assert.equal(result.kind, "ok");
    assert.equal(folderId(sqlite, owner.id, "Parent/Dest/Child"), childId);
    assert.equal(deleteIfEmpty(sqlite, owner.id, "Parent/Dest"), 0);
  });
}

test("failed note insertion rolls back newly registered ancestors", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());
  sqlite.exec(`CREATE TRIGGER reject_note BEFORE INSERT ON notes
    BEGIN SELECT RAISE(ABORT, 'test note failure'); END`);
  await assert.rejects(
    createNoteService(env).create(owner, {
      folder: "Brand/New/Folder",
      markdown: "# Fails",
    }),
    /test note failure/,
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS c FROM folders").get()?.c, 0);
});

test("failed subtree mutation rolls back destination ancestor recreation", async (t) => {
  const { d1, env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());
  const note = await createNoteService(env).create(owner, {
    folder: "Source/Child",
    markdown: "# N",
  });
  assert.ok(!("error" in note));
  const sourceId = folderId(sqlite, owner.id, "Source/Child");
  const oldId = await ensureFolderRow(env, owner.id, "Parent/Dest");
  assert.ok(sourceId && oldId);
  const assertDeleted = deleteBeforeMutation(
    d1,
    owner.id,
    ["Parent/Dest", "Parent"],
    /UPDATE folders SET/,
  );
  sqlite.exec(`CREATE TRIGGER reject_move BEFORE UPDATE OF folder ON notes
    BEGIN SELECT RAISE(ABORT, 'test move failure'); END`);
  await assert.rejects(
    moveFolder(env, sourceId, { destFolderId: oldId }, owner),
    /test move failure/,
  );
  assertDeleted();
  assert.equal(folderId(sqlite, owner.id, "Source/Child"), sourceId);
  assert.equal(folderId(sqlite, owner.id, "Parent"), undefined);
  assert.equal(folderId(sqlite, owner.id, "Parent/Dest"), undefined);
  assert.equal(folderId(sqlite, owner.id, "Parent/Dest/Child"), undefined);
  assertRegisteredPaths(sqlite);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { type TestContext, test } from "node:test";
import { upsertUserByEmail } from "../db/users.ts";
import { actorFromAgent } from "../durable-objects/history-edit.ts";
import { listFolderChildren } from "./access.ts";
import { deleteEmptyFolder } from "./folder-delete.ts";

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
  "0018_scheme_root.sql",
  "0019_folder_delete_events.sql",
];

type QueryResult<T = Record<string, unknown>> = {
  success: true;
  results: T[];
  meta: { changes: number };
};

class StatementAdapter {
  private readonly database: TransactionalD1Adapter;
  readonly query: string;
  private readonly values: SQLInputValue[];

  constructor(
    database: TransactionalD1Adapter,
    query: string,
    values: SQLInputValue[] = [],
  ) {
    this.database = database;
    this.query = query;
    this.values = values;
  }

  bind(...values: SQLInputValue[]): StatementAdapter {
    return new StatementAdapter(this.database, this.query, values);
  }

  execute<T = Record<string, unknown>>(): QueryResult<T> {
    this.database.queries += 1;
    const readOnly = /^\s*(SELECT|PRAGMA|EXPLAIN)\b/i.test(this.query);
    if (!readOnly) {
      this.database.writes += 1;
    }
    const results = this.database.sqlite
      .prepare(this.query)
      .all(...this.values)
      .map((row) => ({ ...row })) as T[];
    const changes = readOnly
      ? 0
      : Number(
          this.database.sqlite.prepare("SELECT changes() AS c").get()?.c ?? 0,
        );
    this.database.afterStatement?.(this.query);
    return { meta: { changes }, results, success: true };
  }

  all<T = Record<string, unknown>>(): Promise<QueryResult<T>> {
    return Promise.resolve(this.execute<T>());
  }

  first<T = Record<string, unknown>>(column?: string): Promise<T | null> {
    const row = this.execute<Record<string, unknown>>().results[0];
    return Promise.resolve(((column ? row?.[column] : row) as T) ?? null);
  }

  run(): Promise<QueryResult> {
    return Promise.resolve(this.execute());
  }
}

/** Real SQLite changes and rollback are essential: a permissive mock hides races. */
class TransactionalD1Adapter {
  readonly sqlite: DatabaseSync;
  queries = 0;
  writes = 0;
  batches = 0;
  lastBatchSize = 0;
  beforeBatch: (() => void) | null = null;
  afterStatement: ((query: string) => void) | null = null;
  failAfterStatement: number | null = null;

  constructor(sqlite: DatabaseSync) {
    this.sqlite = sqlite;
  }

  prepare(query: string): StatementAdapter {
    return new StatementAdapter(this, query);
  }

  batch(statements: StatementAdapter[]): Promise<QueryResult[]> {
    this.batches += 1;
    this.lastBatchSize = statements.length;
    const hook = this.beforeBatch;
    this.beforeBatch = null;
    hook?.();
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((statement, index) => {
        const result = statement.execute();
        if (index === this.failAfterStatement) {
          throw new Error(`injected batch failure ${index}`);
        }
        return result;
      });
      this.sqlite.exec("COMMIT");
      return Promise.resolve(results);
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  resetCounts(): void {
    this.queries = 0;
    this.writes = 0;
    this.batches = 0;
  }
}

async function createEnv(t: TestContext) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  for (const migration of MIGRATIONS) {
    sqlite.exec(
      readFileSync(
        new URL(`../db/migrations/${migration}`, import.meta.url),
        "utf8",
      ),
    );
  }
  const d1 = new TransactionalD1Adapter(sqlite);
  const env = {
    ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
    ALLOW_ANONYMOUS: "false",
    ALLOW_ANONYMOUS_EDITS: "true",
    ALLOW_ANONYMOUS_VIEWS: "true",
    DB: d1,
    DEFAULT_PERMISSION: "editable",
    DEV_AUTH: "false",
  } as unknown as Env;
  const owner = await upsertUserByEmail(env, "owner@example.com", "Owner");
  const viewer = await upsertUserByEmail(env, "viewer@example.com", "Viewer");
  const rootId = addFolder(sqlite, owner.id, "");
  addFolder(sqlite, viewer.id, "");
  return { d1, env, owner, rootId, sqlite, viewer };
}

function addFolder(
  sqlite: DatabaseSync,
  ownerId: string,
  path: string,
): string {
  const id = crypto.randomUUID();
  sqlite
    .prepare(
      "INSERT INTO folders (id, owner_id, folder, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(id, ownerId, path, Date.now());
  return id;
}

function addNote(
  sqlite: DatabaseSync,
  ownerId: string,
  path: string,
  locked = false,
): string {
  const id = crypto.randomUUID();
  sqlite
    .prepare(`INSERT INTO notes
    (id, short_id, owner_id, folder, title, permission, markdown_snapshot, edit_locked, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Keep me', 'private', '# Keep me', ?, ?, ?)`)
    .run(
      id,
      crypto.randomUUID(),
      ownerId,
      path,
      locked ? 1 : 0,
      Date.now(),
      Date.now(),
    );
  return id;
}

function addSource(
  sqlite: DatabaseSync,
  ownerId: string,
  path: string,
): string {
  const id = crypto.randomUUID();
  sqlite
    .prepare(`INSERT INTO article_sources
    (id, owner_id, folder, name, schema_json, created_at, updated_at)
    VALUES (?, ?, ?, 'Do not remove', '{}', ?, ?)`)
    .run(id, ownerId, path, Date.now(), Date.now());
  return id;
}

function addPolicy(sqlite: DatabaseSync, ownerId: string, path: string): void {
  sqlite
    .prepare(`INSERT INTO folder_policies (owner_id, folder, read_scope, write_scope, updated_at)
    VALUES (?, ?, 'signed_in', 'signed_in', ?)`)
    .run(ownerId, path, Date.now());
}

function addGrant(
  sqlite: DatabaseSync,
  ownerId: string,
  path: string,
  kind = "folder",
): string {
  const id = crypto.randomUUID();
  sqlite
    .prepare(`INSERT INTO access_grants
    (id, owner_id, target_kind, target_key, email, user_id, can_write, created_at)
    VALUES (?, ?, ?, ?, ?, NULL, 1, ?)`)
    .run(id, ownerId, kind, path, `${id}@example.com`, Date.now());
  return id;
}

function protect(
  sqlite: DatabaseSync,
  ownerId: string,
  ids: string[] = [],
  patterns: string[] = [],
): void {
  sqlite.prepare("UPDATE users SET settings = ? WHERE id = ?").run(
    JSON.stringify({
      folderDeletion: {
        protectedFolderIds: ids,
        protectedPathPatterns: patterns,
      },
    }),
    ownerId,
  );
}

/** Includes every table (audit, FTS, counters, settings), not only folder rows. */
function databaseSnapshot(sqlite: DatabaseSync): string {
  const names = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all() as { name: string }[];
  return JSON.stringify(
    names.map(({ name }) => [
      name,
      sqlite
        .prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`)
        .all()
        .map((row) => JSON.stringify(row))
        .sort(),
    ]),
  );
}

function rows(sqlite: DatabaseSync, table: string): Record<string, unknown>[] {
  // Table names are test constants, never user input.
  return sqlite.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
}

function assertError(
  result: Awaited<ReturnType<typeof deleteEmptyFolder>>,
  error: string,
) {
  assert.equal(result.kind, "error");
  if (result.kind !== "error") {
    throw new Error(`Expected ${error}`);
  }
  assert.equal(result.error, error);
  return result;
}

test("deletes exactly one empty folder and its own metadata, and updates parent entries", async (t) => {
  const { d1, env, owner, viewer, sqlite } = await createEnv(t);
  const parentId = addFolder(sqlite, owner.id, "Work");
  const id = addFolder(sqlite, owner.id, "Work/Empty");
  addFolder(sqlite, owner.id, "Work/Emptyish");
  addFolder(sqlite, viewer.id, "Work/Empty");
  addPolicy(sqlite, owner.id, "Work/Empty");
  addPolicy(sqlite, owner.id, "Work");
  addPolicy(sqlite, viewer.id, "Work/Empty");
  const removedGrants = [
    addGrant(sqlite, owner.id, "Work/Empty"),
    addGrant(sqlite, owner.id, "Work/Empty"),
  ];
  const keptGrants = [
    addGrant(sqlite, owner.id, "Work"),
    addGrant(sqlite, owner.id, "Work/Emptyish"),
    addGrant(sqlite, viewer.id, "Work/Empty"),
    addGrant(sqlite, owner.id, "Work/Empty", "note"),
  ];
  d1.resetCounts();
  const result = await deleteEmptyFolder(
    env,
    { expected_path: "Work/Empty", folder_id: id },
    owner,
  );
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") {
    return;
  }
  assert.equal(result.result.deleted, true);
  assert.equal(result.result.dryRun, false);
  assert.deepEqual(result.result.folder, { id, parentId, path: "Work/Empty" });
  assert.deepEqual(result.result.removed, {
    folderRows: 1,
    grants: 2,
    policies: 1,
  });
  assert.equal(d1.batches, 1);
  assert.equal(
    rows(sqlite, "folders").some((row) => row.id === id),
    false,
  );
  assert.equal(rows(sqlite, "folder_policies").length, 2);
  assert.deepEqual(
    rows(sqlite, "access_grants").map((row) => row.id),
    keptGrants,
  );
  for (const grantId of removedGrants) {
    assert.equal(
      rows(sqlite, "access_grants").some((row) => row.id === grantId),
      false,
    );
  }
  const entries = await listFolderChildren(
    env,
    owner.id,
    "Work",
    parentId,
    owner,
  );
  assert.equal(
    entries.entries.some((entry) => entry.id === id),
    false,
  );
  assert.equal(
    entries.entries.some(
      (entry) => entry.type === "folder" && entry.name === "Emptyish",
    ),
    true,
  );
  const [audit] = rows(sqlite, "folder_delete_events");
  assert.ok(audit);
  assert.equal(rows(sqlite, "folder_delete_events").length, 1);
  assert.equal(audit.id, result.result.auditId);
  assert.equal(audit.folder_id, id);
  assert.equal(audit.owner_id, owner.id);
  assert.equal(audit.path, "Work/Empty");
  assert.equal(audit.parent_path, "Work");
  assert.equal(audit.actor_kind, "user");
  assert.equal(audit.actor_user_id, owner.id);
  assert.equal(audit.actor_name, "Owner");
  assert.ok(Number(audit.deleted_at) > 0);
});

test("dry_run is completely read-only, including metadata and audit rows", async (t) => {
  const { d1, env, owner, sqlite, rootId } = await createEnv(t);
  const id = addFolder(sqlite, owner.id, "Empty");
  addPolicy(sqlite, owner.id, "Empty");
  addGrant(sqlite, owner.id, "Empty");
  const before = databaseSnapshot(sqlite);
  d1.resetCounts();
  const result = await deleteEmptyFolder(
    env,
    { dry_run: true, folder_id: id },
    owner,
  );
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") {
    return;
  }
  assert.equal(result.result.deleted, false);
  assert.equal(result.result.dryRun, true);
  assert.equal(result.result.canDelete, true);
  assert.equal(result.result.auditId, null);
  assert.deepEqual(result.result.folder, {
    id,
    parentId: rootId,
    path: "Empty",
  });
  assert.ok(result.result.metadata);
  assert.equal(databaseSnapshot(sqlite), before);
  assert.equal(d1.writes, 0);
  assert.equal(d1.batches, 0);
});

test("path resolution is normalized and scoped to the caller's own drive", async (t) => {
  const { env, owner, viewer, sqlite } = await createEnv(t);
  const id = addFolder(sqlite, owner.id, "Work/Empty");
  const foreignId = addFolder(sqlite, viewer.id, "Work/Empty");
  const result = await deleteEmptyFolder(
    env,
    { path: " /Work//Empty/ " },
    owner,
  );
  assert.equal(result.kind, "ok");
  if (result.kind === "ok") {
    assert.equal(result.result.folder.id, id);
  }
  assert.ok(
    sqlite.prepare("SELECT id FROM folders WHERE id = ?").get(foreignId),
  );
  assertError(
    await deleteEmptyFolder(env, { path: "Missing" }, owner),
    "not_found",
  );
});

test("ambiguous and missing target identifiers cannot delete anything", async (t) => {
  const { env, owner, sqlite } = await createEnv(t);
  const id = addFolder(sqlite, owner.id, "One");
  addFolder(sqlite, owner.id, "Two");
  const before = databaseSnapshot(sqlite);
  assertError(
    await deleteEmptyFolder(env, { folder_id: id, path: "Two" }, owner),
    "ambiguous_target",
  );
  const missing = await deleteEmptyFolder(env, {}, owner);
  assert.equal(missing.kind, "error");
  assert.equal(databaseSnapshot(sqlite), before);
  assertError(
    await deleteEmptyFolder(env, { folder_id: "missing-id" }, owner),
    "not_found",
  );
  const matching = await deleteEmptyFolder(
    env,
    { dry_run: true, folder_id: id, path: "One" },
    owner,
  );
  assert.equal(matching.kind, "ok");
});

test("expected_path requires exact equality and is not normalized", async (t) => {
  const { env, owner, sqlite } = await createEnv(t);
  const id = addFolder(sqlite, owner.id, "Work/Empty");
  const before = databaseSnapshot(sqlite);
  for (const expected_path of [
    "Work/Old",
    "/Work/Empty",
    "Work/Empty/",
    " Work/Empty",
    "work/Empty",
    "",
  ]) {
    const result = assertError(
      await deleteEmptyFolder(env, { expected_path, folder_id: id }, owner),
      "path_mismatch",
    );
    assert.equal(result.currentPath, "Work/Empty");
    assert.equal(databaseSnapshot(sqlite), before);
  }
});

test("only owners can delete, even with shared read/write grants", async (t) => {
  const { env, owner, viewer, sqlite } = await createEnv(t);
  const id = addFolder(sqlite, owner.id, "Shared");
  addPolicy(sqlite, owner.id, "Shared");
  sqlite
    .prepare(`INSERT INTO access_grants (id, owner_id, target_kind, target_key, email, user_id, can_write, created_at)
    VALUES (?, ?, 'folder', 'Shared', ?, ?, 1, ?)`)
    .run(crypto.randomUUID(), owner.id, viewer.email, viewer.id, Date.now());
  const before = databaseSnapshot(sqlite);
  const denied = assertError(
    await deleteEmptyFolder(env, { folder_id: id }, viewer),
    "denied",
  );
  assert.equal(denied.status, 403);
  const anonymous = assertError(
    await deleteEmptyFolder(env, { folder_id: id }, undefined),
    "denied",
  );
  assert.equal(anonymous.status, 401);
  assert.equal(databaseSnapshot(sqlite), before);
});

for (const protection of [
  "drive root",
  "projects",
  "areas",
  "resources",
  "archives",
  "PARA space root",
  "scheme root",
  "configured ID",
] as const) {
  test(`rejects protected ${protection} without writes`, async (t) => {
    const { d1, env, owner, sqlite, rootId } = await createEnv(t);
    const id =
      protection === "drive root"
        ? rootId
        : addFolder(sqlite, owner.id, "Protected");
    if (["projects", "areas", "resources", "archives"].includes(protection)) {
      sqlite
        .prepare("UPDATE folders SET para_bucket = ? WHERE id = ?")
        .run(protection, id);
    } else if (protection === "PARA space root") {
      sqlite
        .prepare(
          "INSERT INTO para_spaces (id, owner_id, name, root_folder_id, created_at) VALUES (?, ?, 'Work', ?, ?)",
        )
        .run(crypto.randomUUID(), owner.id, id, Date.now());
    } else if (protection === "scheme root") {
      sqlite.prepare("UPDATE folders SET scheme = 'jd' WHERE id = ?").run(id);
    } else if (protection === "configured ID") {
      protect(sqlite, owner.id, [id]);
    }
    const before = databaseSnapshot(sqlite);
    d1.resetCounts();
    for (const dry_run of [true, false]) {
      assertError(
        await deleteEmptyFolder(env, { dry_run, folder_id: id }, owner),
        "protected_folder",
      );
    }
    assert.equal(databaseSnapshot(sqlite), before);
    assert.equal(d1.writes, 0);
  });
}

for (const [pattern, path] of [
  ["Inbox", "Inbox"],
  ["*/_keep", "Work/_keep"],
  ["**/.keep", "Work/Deep/.keep"],
  ["**/.keep", ".keep"],
  ["[literal]", "[literal]"],
] as const) {
  test(`protects path ${path} with pattern ${pattern}`, async (t) => {
    const { env, owner, sqlite } = await createEnv(t);
    const id = addFolder(sqlite, owner.id, path);
    protect(sqlite, owner.id, [], [pattern]);
    const before = databaseSnapshot(sqlite);
    assertError(
      await deleteEmptyFolder(env, { folder_id: id }, owner),
      "protected_folder",
    );
    assert.equal(databaseSnapshot(sqlite), before);
  });
}

test("single-star patterns do not cross separators and exact patterns do not match prefixes", async (t) => {
  const { env, owner, sqlite } = await createEnv(t);
  protect(sqlite, owner.id, [], ["Inbox", "*/_keep"]);
  for (const path of ["Inbox-old", "Work/Deep/_keep", "Work/_keep-old"]) {
    const id = addFolder(sqlite, owner.id, path);
    const result = await deleteEmptyFolder(env, { folder_id: id }, owner);
    assert.equal(result.kind, "ok");
  }
});

test("drive root paths are refused even when normalized from whitespace or slashes", async (t) => {
  const { env, owner, sqlite } = await createEnv(t);
  const before = databaseSnapshot(sqlite);
  for (const path of ["", "/", "  ///  "]) {
    assertError(
      await deleteEmptyFolder(env, { path }, owner),
      "protected_folder",
    );
  }
  assert.equal(databaseSnapshot(sqlite), before);
});

test("counts all descendant notes, subfolders, sources, and locks despite missing intermediate rows", async (t) => {
  const { d1, env, owner, viewer, sqlite } = await createEnv(t);
  const path = `Long_%_日本語😀/${"segment".repeat(12)}`;
  const id = addFolder(sqlite, owner.id, path);
  addNote(sqlite, owner.id, path);
  addNote(sqlite, owner.id, `${path}/missing/deep`, true);
  addNote(sqlite, owner.id, `${path}/missing/other`);
  addFolder(sqlite, owner.id, `${path}/missing/child`);
  addSource(sqlite, owner.id, `${path}/absent/source`);
  // Similar prefixes and other owners must never contaminate the counts.
  addNote(sqlite, owner.id, `${path}-sibling`, true);
  addNote(sqlite, viewer.id, path, true);
  addFolder(sqlite, viewer.id, `${path}/foreign`);
  addSource(sqlite, viewer.id, path);
  addPolicy(sqlite, owner.id, path);
  addGrant(sqlite, owner.id, path);
  const before = databaseSnapshot(sqlite);
  d1.resetCounts();
  for (const dry_run of [true, false]) {
    const result = assertError(
      await deleteEmptyFolder(env, { dry_run, folder_id: id }, owner),
      "folder_not_empty",
    );
    assert.deepEqual(result.counts, {
      articleSources: 1,
      lockedNotes: 1,
      notes: 3,
      subfolders: 1,
    });
  }
  assert.equal(databaseSnapshot(sqlite), before);
  assert.equal(d1.writes, 0);
});

for (const content of ["subfolder", "article source", "locked note"] as const) {
  test(`a lone ${content} prevents deletion`, async (t) => {
    const { env, owner, sqlite } = await createEnv(t);
    const id = addFolder(sqlite, owner.id, "Target");
    if (content === "subfolder") {
      addFolder(sqlite, owner.id, "Target/Sub");
    }
    if (content === "article source") {
      addSource(sqlite, owner.id, "Target");
    }
    if (content === "locked note") {
      addNote(sqlite, owner.id, "Target", true);
    }
    const before = databaseSnapshot(sqlite);
    const result = assertError(
      await deleteEmptyFolder(env, { folder_id: id }, owner),
      "folder_not_empty",
    );
    assert.deepEqual(result.counts, {
      articleSources: content === "article source" ? 1 : 0,
      lockedNotes: content === "locked note" ? 1 : 0,
      notes: content === "locked note" ? 1 : 0,
      subfolders: content === "subfolder" ? 1 : 0,
    });
    assert.equal(databaseSnapshot(sqlite), before);
  });
}

for (const race of ["note", "subfolder", "article source"] as const) {
  test(`a concurrent ${race} makes conditional DELETE change zero rows and preserves all metadata`, async (t) => {
    const { d1, env, owner, sqlite } = await createEnv(t);
    const id = addFolder(sqlite, owner.id, "Target");
    addPolicy(sqlite, owner.id, "Target");
    addGrant(sqlite, owner.id, "Target");
    let afterRace = "";
    d1.beforeBatch = () => {
      if (race === "note") {
        addNote(sqlite, owner.id, "Target/Missing/Deep", true);
      }
      if (race === "subfolder") {
        addFolder(sqlite, owner.id, "Target/Sub");
      }
      if (race === "article source") {
        addSource(sqlite, owner.id, "Target/Source");
      }
      afterRace = databaseSnapshot(sqlite);
    };
    const result = assertError(
      await deleteEmptyFolder(env, { folder_id: id }, owner),
      "folder_not_empty",
    );
    assert.deepEqual(result.counts, {
      articleSources: race === "article source" ? 1 : 0,
      lockedNotes: race === "note" ? 1 : 0,
      notes: race === "note" ? 1 : 0,
      subfolders: race === "subfolder" ? 1 : 0,
    });
    assert.ok(afterRace, "race hook ran between preflight and transaction");
    assert.equal(databaseSnapshot(sqlite), afterRace);
  });
}

test("concurrent rename returns current path and cannot remove metadata at either path", async (t) => {
  const { d1, env, owner, sqlite } = await createEnv(t);
  const id = addFolder(sqlite, owner.id, "Old");
  addPolicy(sqlite, owner.id, "Old");
  addGrant(sqlite, owner.id, "Old");
  let afterRace = "";
  d1.beforeBatch = () => {
    sqlite.prepare("UPDATE folders SET folder = 'New' WHERE id = ?").run(id);
    addPolicy(sqlite, owner.id, "New");
    addGrant(sqlite, owner.id, "New");
    afterRace = databaseSnapshot(sqlite);
  };
  const result = assertError(
    await deleteEmptyFolder(
      env,
      { expected_path: "Old", folder_id: id },
      owner,
    ),
    "path_mismatch",
  );
  assert.equal(result.currentPath, "New");
  assert.equal(databaseSnapshot(sqlite), afterRace);
});

for (const replacement of [false, true]) {
  test(`concurrently removed folder${replacement ? " replaced at the same path" : ""} does not authorize metadata cleanup`, async (t) => {
    const { d1, env, owner, sqlite } = await createEnv(t);
    const id = addFolder(sqlite, owner.id, "Target");
    addPolicy(sqlite, owner.id, "Target");
    addGrant(sqlite, owner.id, "Target");
    let afterRace = "";
    d1.beforeBatch = () => {
      sqlite.prepare("DELETE FROM folders WHERE id = ?").run(id);
      if (replacement) {
        addFolder(sqlite, owner.id, "Target");
      }
      afterRace = databaseSnapshot(sqlite);
    };
    assertError(
      await deleteEmptyFolder(env, { folder_id: id }, owner),
      "not_found",
    );
    assert.equal(databaseSnapshot(sqlite), afterRace);
  });
}

for (const protection of [
  "bucket",
  "scheme",
  "space",
  "settings ID",
  "settings pattern",
] as const) {
  test(`concurrent ${protection} protection is checked atomically`, async (t) => {
    const { d1, env, owner, sqlite } = await createEnv(t);
    const id = addFolder(sqlite, owner.id, "Target");
    addPolicy(sqlite, owner.id, "Target");
    addGrant(sqlite, owner.id, "Target");
    let afterRace = "";
    d1.beforeBatch = () => {
      if (protection === "bucket") {
        sqlite
          .prepare("UPDATE folders SET para_bucket = 'projects' WHERE id = ?")
          .run(id);
      }
      if (protection === "scheme") {
        sqlite.prepare("UPDATE folders SET scheme = 'jd' WHERE id = ?").run(id);
      }
      if (protection === "space") {
        sqlite
          .prepare(
            "INSERT INTO para_spaces (id, owner_id, name, root_folder_id, created_at) VALUES (?, ?, 'Work', ?, ?)",
          )
          .run(crypto.randomUUID(), owner.id, id, Date.now());
      }
      if (protection === "settings ID") {
        protect(sqlite, owner.id, [id]);
      }
      if (protection === "settings pattern") {
        protect(sqlite, owner.id, [], ["Target"]);
      }
      afterRace = databaseSnapshot(sqlite);
    };
    assertError(
      await deleteEmptyFolder(env, { folder_id: id }, owner),
      "protected_folder",
    );
    assert.equal(databaseSnapshot(sqlite), afterRace);
  });
}

test("retrying an old UUID does not delete a recreated folder at the same path", async (t) => {
  const { env, owner, sqlite } = await createEnv(t);
  const id = addFolder(sqlite, owner.id, "Reusable");
  assert.equal(
    (await deleteEmptyFolder(env, { folder_id: id }, owner)).kind,
    "ok",
  );
  const afterDelete = databaseSnapshot(sqlite);
  assertError(
    await deleteEmptyFolder(env, { folder_id: id }, owner),
    "not_found",
  );
  assert.equal(databaseSnapshot(sqlite), afterDelete);
  const recreated = addFolder(sqlite, owner.id, "Reusable");
  addPolicy(sqlite, owner.id, "Reusable");
  addGrant(sqlite, owner.id, "Reusable");
  const afterRecreation = databaseSnapshot(sqlite);
  assertError(
    await deleteEmptyFolder(env, { folder_id: id }, owner),
    "not_found",
  );
  assert.equal(databaseSnapshot(sqlite), afterRecreation);
  assert.equal(
    (await deleteEmptyFolder(env, { folder_id: recreated }, owner)).kind,
    "ok",
  );
  assert.deepEqual(
    rows(sqlite, "folder_delete_events").map((row) => row.folder_id),
    [id, recreated],
  );
});

test("each batch stage rolls back the folder, metadata, and audit together on failure", async (t) => {
  const probe = await createEnv(t);
  const probeId = addFolder(probe.sqlite, probe.owner.id, "Probe");
  addPolicy(probe.sqlite, probe.owner.id, "Probe");
  addGrant(probe.sqlite, probe.owner.id, "Probe");
  assert.equal(
    (await deleteEmptyFolder(probe.env, { folder_id: probeId }, probe.owner))
      .kind,
    "ok",
  );
  assert.ok(
    probe.d1.lastBatchSize >= 4,
    "folder, policy, grants, and audit are transactional",
  );
  for (
    let failureIndex = 0;
    failureIndex < probe.d1.lastBatchSize;
    failureIndex += 1
  ) {
    const { d1, env, owner, sqlite } = await createEnv(t);
    const id = addFolder(sqlite, owner.id, "Target");
    addPolicy(sqlite, owner.id, "Target");
    addGrant(sqlite, owner.id, "Target");
    const before = databaseSnapshot(sqlite);
    d1.failAfterStatement = failureIndex;
    await assert.rejects(
      deleteEmptyFolder(env, { folder_id: id }, owner),
      /injected batch failure/,
    );
    assert.equal(
      databaseSnapshot(sqlite),
      before,
      `rollback after statement ${failureIndex}`,
    );
  }
});

test("query count is constant across folder depth and subtree size", async (t) => {
  const { d1, env, owner, sqlite } = await createEnv(t);
  const emptyQueries: number[] = [];
  const nonemptyQueries: number[] = [];
  for (const depth of [1, 60]) {
    const path = Array.from({ length: depth }, (_, i) => `part-${i}`).join("/");
    const id = addFolder(sqlite, owner.id, path);
    d1.resetCounts();
    assert.equal(
      (await deleteEmptyFolder(env, { folder_id: id }, owner)).kind,
      "ok",
    );
    assert.equal(d1.batches, 1);
    emptyQueries.push(d1.queries);
  }
  for (const count of [1, 100]) {
    const path = `Nonempty-${count}`;
    const id = addFolder(sqlite, owner.id, path);
    for (let i = 0; i < count; i += 1) {
      addFolder(sqlite, owner.id, `${path}/sub-${i}`);
      addNote(sqlite, owner.id, `${path}/sub-${i}`);
    }
    d1.resetCounts();
    assertError(
      await deleteEmptyFolder(env, { folder_id: id }, owner),
      "folder_not_empty",
    );
    nonemptyQueries.push(d1.queries);
  }
  assert.equal(emptyQueries[0], emptyQueries[1]);
  assert.equal(nonemptyQueries[0], nonemptyQueries[1]);
  assert.ok(
    emptyQueries[1] <= 24,
    `bounded successful call: ${emptyQueries[1]}`,
  );
  assert.ok(
    nonemptyQueries[1] <= 16,
    `bounded rejected call: ${nonemptyQueries[1]}`,
  );
});

test("agent audit snapshots preserve every folder field, its policy, and folder grants", async (t) => {
  const { d1, env, owner, sqlite } = await createEnv(t);
  const scopeId = addFolder(sqlite, owner.id, "Scope");
  sqlite.prepare("UPDATE folders SET scheme = 'jd' WHERE id = ?").run(scopeId);
  sqlite
    .prepare(
      "INSERT INTO id_counters (owner_id, scope, next_value) VALUES (?, ?, 42)",
    )
    .run(owner.id, `jd:id:${scopeId}:11`);
  const id = addFolder(sqlite, owner.id, "Scope/11.01 Empty");
  const setId = crypto.randomUUID();
  sqlite
    .prepare(
      "INSERT INTO medallion_sets (id, owner_user_id, name, layers, created_at) VALUES (?, ?, 'Quality', '[]', ?)",
    )
    .run(setId, owner.id, Date.now());
  sqlite
    .prepare(`UPDATE folders SET scheme = 'jd', scheme_id = '11.01', scheme_title = 'Empty',
    scheme_root = ?, medallion_set_id = ?, medallion_layer = 'silver' WHERE id = ?`)
    .run(scopeId, setId, id);
  addPolicy(sqlite, owner.id, "Scope/11.01 Empty");
  addGrant(sqlite, owner.id, "Scope/11.01 Empty");
  const scopeBefore = JSON.stringify(rows(sqlite, "id_counters"));
  const actor = actorFromAgent({ displayName: "Owner", userId: owner.id });
  const dryBefore = databaseSnapshot(sqlite);
  const dry = await deleteEmptyFolder(
    env,
    { dry_run: true, folder_id: id },
    owner,
    actor,
  );
  assert.equal(dry.kind, "ok");
  if (dry.kind !== "ok") {
    return;
  }
  assert.deepEqual(dry.result.metadata, {
    grants: 1,
    medallion: true,
    policy: true,
    scheme: true,
  });
  assert.deepEqual(dry.result.removed, {
    folderRows: 1,
    grants: 1,
    policies: 1,
  });
  assert.equal(databaseSnapshot(sqlite), dryBefore);

  let expectedFolder: Record<string, unknown> = {};
  let expectedPolicy: Record<string, unknown> = {};
  let expectedGrants: Record<string, unknown>[] = [];
  // The audit must reflect live transaction-time metadata, not the dry run or preflight.
  d1.beforeBatch = () => {
    sqlite
      .prepare(
        "UPDATE folders SET scheme_title = 'Edited after scan', medallion_layer = 'gold' WHERE id = ?",
      )
      .run(id);
    sqlite
      .prepare(
        "UPDATE folder_policies SET read_scope = 'self', write_scope = 'self', updated_at = 12345 WHERE owner_id = ? AND folder = ?",
      )
      .run(owner.id, "Scope/11.01 Empty");
    addGrant(sqlite, owner.id, "Scope/11.01 Empty");
    expectedFolder = {
      ...sqlite.prepare("SELECT * FROM folders WHERE id = ?").get(id),
    };
    expectedPolicy = {
      ...sqlite
        .prepare(
          "SELECT * FROM folder_policies WHERE owner_id = ? AND folder = ?",
        )
        .get(owner.id, "Scope/11.01 Empty"),
    };
    expectedGrants = rows(sqlite, "access_grants").map((row) => ({ ...row }));
  };
  const startedAt = Date.now();
  const result = await deleteEmptyFolder(env, { folder_id: id }, owner, actor);
  const endedAt = Date.now();
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") {
    return;
  }
  assert.deepEqual(result.result.removed, {
    folderRows: 1,
    grants: 2,
    policies: 1,
  });
  assert.equal(result.result.metadata.grants, 2);
  const [audit] = rows(sqlite, "folder_delete_events");
  assert.equal(audit.actor_kind, "agent");
  assert.equal(audit.actor_user_id, owner.id);
  assert.equal(audit.actor_name, "AI(Owner)");
  assert.ok(
    Number(audit.deleted_at) >= startedAt &&
      Number(audit.deleted_at) <= endedAt,
  );
  const snapshot = JSON.parse(String(audit.snapshot));
  assert.deepEqual(snapshot.folder, expectedFolder);
  assert.deepEqual(snapshot.policy, expectedPolicy);
  assert.deepEqual(
    snapshot.grants.sort((a: { id: string }, b: { id: string }) =>
      a.id.localeCompare(b.id),
    ),
    expectedGrants.sort((a, b) => String(a.id).localeCompare(String(b.id))),
  );
  assert.equal(JSON.stringify(rows(sqlite, "id_counters")), scopeBefore);
  assert.ok(sqlite.prepare("SELECT id FROM folders WHERE id = ?").get(scopeId));
  assert.ok(
    sqlite.prepare("SELECT id FROM medallion_sets WHERE id = ?").get(setId),
  );
});

test("an empty metadata snapshot has explicit null policy and no grants", async (t) => {
  const { env, owner, sqlite } = await createEnv(t);
  const id = addFolder(sqlite, owner.id, "Empty");
  const result = await deleteEmptyFolder(env, { folder_id: id }, owner);
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") {
    return;
  }
  assert.deepEqual(result.result.metadata, {
    grants: 0,
    medallion: false,
    policy: false,
    scheme: false,
  });
  const [audit] = rows(sqlite, "folder_delete_events");
  const snapshot = JSON.parse(String(audit.snapshot));
  assert.equal(snapshot.folder.id, id);
  assert.equal(snapshot.folder.para_bucket, null);
  assert.equal(snapshot.folder.scheme, null);
  assert.equal(snapshot.folder.scheme_id, null);
  assert.equal(snapshot.folder.medallion_set_id, null);
  assert.equal(snapshot.folder.medallion_layer, null);
  assert.equal(snapshot.policy, null);
  assert.deepEqual(snapshot.grants, []);
});

test("a suppressed zero-row DELETE preserves metadata and removes its candidate audit", async (t) => {
  const { env, owner, sqlite } = await createEnv(t);
  const id = addFolder(sqlite, owner.id, "Target");
  addPolicy(sqlite, owner.id, "Target");
  addGrant(sqlite, owner.id, "Target");
  sqlite.exec(
    "CREATE TRIGGER suppress_folder_delete BEFORE DELETE ON folders BEGIN SELECT RAISE(IGNORE); END",
  );
  const before = databaseSnapshot(sqlite);
  assertError(
    await deleteEmptyFolder(env, { folder_id: id }, owner),
    "state_changed",
  );
  assert.equal(databaseSnapshot(sqlite), before);
});

test("unrelated concurrent settings changes fail closed without deleting or retrying", async (t) => {
  const { d1, env, owner, sqlite } = await createEnv(t);
  const id = addFolder(sqlite, owner.id, "Target");
  addPolicy(sqlite, owner.id, "Target");
  addGrant(sqlite, owner.id, "Target");
  let afterRace = "";
  d1.beforeBatch = () => {
    sqlite
      .prepare("UPDATE users SET settings = ? WHERE id = ?")
      .run('{"knowledge":{"para":true}}', owner.id);
    afterRace = databaseSnapshot(sqlite);
  };
  d1.resetCounts();
  assertError(
    await deleteEmptyFolder(env, { folder_id: id }, owner),
    "state_changed",
  );
  assert.equal(d1.batches, 1);
  assert.equal(databaseSnapshot(sqlite), afterRace);
});

test("malformed protection settings fail closed without modifying the user", async (t) => {
  const { env, owner, sqlite } = await createEnv(t);
  const id = addFolder(sqlite, owner.id, "Target");
  sqlite
    .prepare("UPDATE users SET settings = '{malformed' WHERE id = ?")
    .run(owner.id);
  const before = databaseSnapshot(sqlite);
  assertError(
    await deleteEmptyFolder(env, { folder_id: id }, owner),
    "protected_folder",
  );
  assert.equal(databaseSnapshot(sqlite), before);
});

test("an audit actor cannot impersonate another user or guest", async (t) => {
  const { env, owner, viewer, sqlite } = await createEnv(t);
  const id = addFolder(sqlite, owner.id, "Target");
  const before = databaseSnapshot(sqlite);
  assertError(
    await deleteEmptyFolder(
      env,
      { folder_id: id },
      owner,
      actorFromAgent({ displayName: "Viewer", userId: viewer.id }),
    ),
    "denied",
  );
  assertError(
    await deleteEmptyFolder(env, { folder_id: id }, owner, {
      kind: "guest",
      name: "Guest",
      userId: null,
    }),
    "denied",
  );
  assert.equal(databaseSnapshot(sqlite), before);
});

test("notes and sources in sibling paths or another drive do not prevent deletion", async (t) => {
  const { env, owner, viewer, sqlite } = await createEnv(t);
  const id = addFolder(sqlite, owner.id, "Exact_%");
  addNote(sqlite, owner.id, "Exact_%extra", true);
  addSource(sqlite, owner.id, "Exact_%extra");
  addNote(sqlite, viewer.id, "Exact_%/Nested", true);
  addSource(sqlite, viewer.id, "Exact_%");
  addFolder(sqlite, viewer.id, "Exact_%/Nested");
  const notesBefore = JSON.stringify(rows(sqlite, "notes"));
  const sourcesBefore = JSON.stringify(rows(sqlite, "article_sources"));
  assert.equal(
    (await deleteEmptyFolder(env, { folder_id: id }, owner)).kind,
    "ok",
  );
  assert.equal(JSON.stringify(rows(sqlite, "notes")), notesBefore);
  assert.equal(JSON.stringify(rows(sqlite, "article_sources")), sourcesBefore);
});

test("configured UUID protection survives a folder rename and is owner-scoped", async (t) => {
  const { env, owner, viewer, sqlite } = await createEnv(t);
  const id = addFolder(sqlite, owner.id, "Before");
  protect(sqlite, owner.id, [id]);
  sqlite.prepare("UPDATE folders SET folder = 'After' WHERE id = ?").run(id);
  const before = databaseSnapshot(sqlite);
  assertError(
    await deleteEmptyFolder(env, { folder_id: id }, owner),
    "protected_folder",
  );
  assert.equal(databaseSnapshot(sqlite), before);
  const foreign = addFolder(sqlite, viewer.id, "After");
  assert.equal(
    (await deleteEmptyFolder(env, { folder_id: foreign }, viewer)).kind,
    "ok",
  );
});

test("an ownership change between preflight and deletion fails without cleanup", async (t) => {
  const { d1, env, owner, viewer, sqlite } = await createEnv(t);
  const id = addFolder(sqlite, owner.id, "Target");
  addPolicy(sqlite, owner.id, "Target");
  addGrant(sqlite, owner.id, "Target");
  let afterRace = "";
  d1.beforeBatch = () => {
    sqlite
      .prepare("UPDATE folders SET owner_id = ? WHERE id = ?")
      .run(viewer.id, id);
    afterRace = databaseSnapshot(sqlite);
  };
  assertError(await deleteEmptyFolder(env, { folder_id: id }, owner), "denied");
  assert.equal(databaseSnapshot(sqlite), afterRace);
});

for (const dry_run of [true, false]) {
  test(`rename between target resolution and inspection respects expected_path (dry_run=${dry_run})`, async (t) => {
    const { d1, env, owner, sqlite } = await createEnv(t);
    const id = addFolder(sqlite, owner.id, "Empty");
    addPolicy(sqlite, owner.id, "Empty");
    addGrant(sqlite, owner.id, "Empty");
    protect(sqlite, owner.id, [], ["Protected"]);
    let afterRace = "";
    d1.afterStatement = (query) => {
      if (!/^SELECT \* FROM folders WHERE id = \?/i.test(query)) {
        return;
      }
      d1.afterStatement = null;
      sqlite
        .prepare("UPDATE folders SET folder = 'Protected' WHERE id = ?")
        .run(id);
      afterRace = databaseSnapshot(sqlite);
    };
    d1.resetCounts();
    const result = assertError(
      await deleteEmptyFolder(
        env,
        { dry_run, expected_path: "Empty", folder_id: id },
        owner,
      ),
      "path_mismatch",
    );
    assert.equal(result.currentPath, "Protected");
    assert.ok(afterRace, "rename occurs after the initial SELECT snapshot");
    assert.equal(databaseSnapshot(sqlite), afterRace);
    assert.equal(d1.writes, 0);
    assert.equal(d1.batches, 0);
  });
}

for (const protection of ["bucket", "scheme"] as const) {
  test(`dry run uses current ${protection} metadata after initial target resolution`, async (t) => {
    const { d1, env, owner, sqlite } = await createEnv(t);
    const id = addFolder(sqlite, owner.id, "Empty");
    let afterRace = "";
    d1.afterStatement = (query) => {
      if (!/^SELECT \* FROM folders WHERE id = \?/i.test(query)) {
        return;
      }
      d1.afterStatement = null;
      if (protection === "bucket") {
        sqlite
          .prepare("UPDATE folders SET para_bucket = 'projects' WHERE id = ?")
          .run(id);
      }
      if (protection === "scheme") {
        sqlite.prepare("UPDATE folders SET scheme = 'jd' WHERE id = ?").run(id);
      }
      afterRace = databaseSnapshot(sqlite);
    };
    d1.resetCounts();
    assertError(
      await deleteEmptyFolder(env, { dry_run: true, folder_id: id }, owner),
      "protected_folder",
    );
    assert.ok(afterRace, "protection occurs after the initial SELECT snapshot");
    assert.equal(databaseSnapshot(sqlite), afterRace);
    assert.equal(d1.writes, 0);
    assert.equal(d1.batches, 0);
  });
}

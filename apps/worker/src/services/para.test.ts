import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { upsertUserByEmail } from "../db/users.ts";
import { ensureFolderRow } from "./access.ts";
import { createNoteService } from "./notes.ts";
import { enablePara, paraList, paraPlan } from "./para.ts";

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
    DB: new D1DatabaseAdapter(sqlite),
    DEV_AUTH: "false",
  } as unknown as Env;

  const owner = await upsertUserByEmail(env, "owner@example.com", "Owner");
  const other = await upsertUserByEmail(env, "other@example.com", "Other");
  return { env, other, owner, sqlite };
}

function folderRow(sqlite: DatabaseSync, ownerId: string, path: string) {
  return sqlite
    .prepare(
      "SELECT id, folder, para_bucket FROM folders WHERE owner_id = ? AND folder = ?",
    )
    .get(ownerId, path) as
    | { folder: string; id: string; para_bucket: string | null }
    | undefined;
}

function folderById(sqlite: DatabaseSync, id: string) {
  return sqlite
    .prepare("SELECT id, folder, para_bucket FROM folders WHERE id = ?")
    .get(id) as
    | { folder: string; id: string; para_bucket: string | null }
    | undefined;
}

function folderCount(sqlite: DatabaseSync, ownerId: string): number {
  const row = sqlite
    .prepare("SELECT COUNT(*) AS c FROM folders WHERE owner_id = ?")
    .get(ownerId) as { c: number };
  return row.c;
}

test("paraPlan reports all buckets vacant on a fresh drive", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  const result = await paraPlan(env, owner);
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") {
    return;
  }
  assert.equal(result.plan.space.status, "exists");
  assert.deepEqual(
    result.plan.buckets.map((bucket) => [bucket.bucket, bucket.status]),
    [
      ["projects", "vacant"],
      ["areas", "vacant"],
      ["resources", "vacant"],
      ["archives", "vacant"],
    ],
  );
  // plan must be side-effect-free.
  assert.equal(folderCount(sqlite, owner.id), 0);
});

test("paraPlan reports collision when a default name is taken", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  const existingId = await ensureFolderRow(env, owner.id, "Projects");
  assert.ok(existingId);

  const result = await paraPlan(env, owner);
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") {
    return;
  }
  const projects = result.plan.buckets.find((b) => b.bucket === "projects");
  assert.equal(projects?.status, "collision");
  assert.deepEqual(projects?.existing, { id: existingId, name: "Projects" });
  assert.equal(
    result.plan.buckets.find((b) => b.bucket === "areas")?.status,
    "vacant",
  );
});

test("paraPlan reports assigned buckets with their folder", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  const enabled = await enablePara(env, {}, owner);
  assert.equal(enabled.kind, "ok");

  const result = await paraPlan(env, owner);
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") {
    return;
  }
  for (const bucket of result.plan.buckets) {
    assert.equal(bucket.status, "assigned");
    assert.ok(bucket.existing?.id);
  }
  assert.equal(
    result.plan.buckets.find((b) => b.bucket === "projects")?.existing?.name,
    "Projects",
  );
});

test("paraPlan requires a signed-in user", async (t) => {
  const { env, sqlite } = await createEnv();
  t.after(() => sqlite.close());
  const result = await paraPlan(env, undefined);
  assert.equal(result.kind, "denied");
});

test("paraList is read-only and returns no buckets before setup", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  const result = await paraList(env, owner);
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") {
    return;
  }
  assert.deepEqual(result.result.buckets, []);
  // GET must not materialize folders anymore.
  assert.equal(folderCount(sqlite, owner.id), 0);
});

test("enablePara creates all four buckets when nothing collides", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  const result = await enablePara(env, {}, owner);
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") {
    return;
  }
  assert.deepEqual(result.result.pending, []);
  assert.ok(
    result.result.plan.buckets.every((bucket) => bucket.status === "assigned"),
  );

  for (const name of ["Projects", "Areas", "Resources", "Archives"]) {
    const row = folderRow(sqlite, owner.id, name);
    assert.ok(row, `missing bucket folder ${name}`);
    assert.ok(row.para_bucket);
  }
  assert.equal(
    folderRow(sqlite, owner.id, "Projects")?.para_bucket,
    "projects",
  );
});

test("enablePara is idempotent", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  await enablePara(env, {}, owner);
  const afterFirst = folderCount(sqlite, owner.id);
  const second = await enablePara(env, {}, owner);
  assert.equal(second.kind, "ok");
  assert.equal(folderCount(sqlite, owner.id), afterFirst);
});

test("enablePara reports unresolved collisions without touching them", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  const existingId = await ensureFolderRow(env, owner.id, "Projects");
  assert.ok(existingId);

  const result = await enablePara(env, {}, owner);
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") {
    return;
  }
  assert.deepEqual(result.result.pending, ["projects"]);
  assert.equal(
    result.result.plan.buckets.find((b) => b.bucket === "projects")?.status,
    "collision",
  );
  // The colliding folder is left alone and other buckets are still created.
  assert.equal(folderById(sqlite, existingId)?.para_bucket, null);
  assert.ok(folderRow(sqlite, owner.id, "Areas")?.para_bucket === "areas");
});

test("enablePara rename resolution frees the name then creates the bucket", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());
  const notes = createNoteService(env);

  const projectId = await ensureFolderRow(env, owner.id, "Projects");
  assert.ok(projectId);
  const note = await notes.create(owner, {
    folder: "Projects/Web",
    markdown: "# Web",
  });
  assert.ok(!("error" in note));

  const result = await enablePara(
    env,
    {
      resolutions: {
        projects: {
          action: "rename",
          folderId: projectId,
          newName: "旧 Projects",
        },
      },
    },
    owner,
  );
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") {
    return;
  }
  assert.deepEqual(result.result.pending, []);

  // The whole subtree moved with the rename.
  const renamed = folderById(sqlite, projectId);
  assert.equal(renamed?.folder, "旧 Projects");
  assert.equal(renamed?.para_bucket, null);
  const bucket = folderRow(sqlite, owner.id, "Projects");
  assert.equal(bucket?.para_bucket, "projects");
  assert.notEqual(bucket?.id, projectId);
  const movedNote = sqlite
    .prepare("SELECT folder FROM notes WHERE id = ?")
    .get(note.id) as { folder: string };
  assert.equal(movedNote.folder, "旧 Projects/Web");
});

test("enablePara adopt resolution assigns the existing folder", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  const projectId = await ensureFolderRow(env, owner.id, "Projects");
  assert.ok(projectId);

  const result = await enablePara(
    env,
    { resolutions: { projects: { action: "adopt", folderId: projectId } } },
    owner,
  );
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") {
    return;
  }
  assert.deepEqual(result.result.pending, []);
  assert.equal(folderById(sqlite, projectId)?.para_bucket, "projects");
  // No duplicate Projects folder was created.
  const dupes = sqlite
    .prepare(
      "SELECT COUNT(*) AS c FROM folders WHERE owner_id = ? AND folder = 'Projects'",
    )
    .get(owner.id) as { c: number };
  assert.equal(dupes.c, 1);
});

test("enablePara skip leaves the bucket unassigned and out of pending", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  const projectId = await ensureFolderRow(env, owner.id, "Projects");
  assert.ok(projectId);

  const result = await enablePara(
    env,
    { resolutions: { projects: { action: "skip" } } },
    owner,
  );
  assert.equal(result.kind, "ok");
  if (result.kind !== "ok") {
    return;
  }
  assert.deepEqual(result.result.pending, []);
  assert.equal(
    result.result.plan.buckets.find((b) => b.bucket === "projects")?.status,
    "collision",
  );
  assert.equal(folderById(sqlite, projectId)?.para_bucket, null);
});

test("enablePara can be re-run to resolve a leftover collision (loop)", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  const projectId = await ensureFolderRow(env, owner.id, "Projects");
  assert.ok(projectId);

  const first = await enablePara(env, {}, owner);
  assert.equal(first.kind, "ok");
  if (first.kind !== "ok") {
    return;
  }
  assert.deepEqual(first.result.pending, ["projects"]);

  const second = await enablePara(
    env,
    { resolutions: { projects: { action: "adopt", folderId: projectId } } },
    owner,
  );
  assert.equal(second.kind, "ok");
  if (second.kind !== "ok") {
    return;
  }
  assert.deepEqual(second.result.pending, []);
  assert.ok(
    second.result.plan.buckets.every((bucket) => bucket.status === "assigned"),
  );
});

test("enablePara rejects resolutions with an unknown bucket key", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  const result = await enablePara(
    env,
    {
      resolutions: {
        // @ts-expect-error intentionally invalid key
        bogus: { action: "create" },
      },
    },
    owner,
  );
  assert.equal(result.kind, "invalid");
});

test("enablePara rejects adopt for a missing folder", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  const result = await enablePara(
    env,
    {
      resolutions: {
        projects: { action: "adopt", folderId: "no-such-folder" },
      },
    },
    owner,
  );
  assert.equal(result.kind, "not_found");
});

test("enablePara rejects adopt/rename of another user's folder", async (t) => {
  const { env, other, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  const foreignId = await ensureFolderRow(env, other.id, "Projects");
  assert.ok(foreignId);

  const adopted = await enablePara(
    env,
    { resolutions: { projects: { action: "adopt", folderId: foreignId } } },
    owner,
  );
  assert.equal(adopted.kind, "denied");

  const renamed = await enablePara(
    env,
    {
      resolutions: {
        projects: { action: "rename", folderId: foreignId, newName: "x" },
      },
    },
    owner,
  );
  assert.equal(renamed.kind, "denied");
  assert.equal(folderById(sqlite, foreignId)?.folder, "Projects");
});

test("enablePara rejects adopt/rename of a non-top-level folder", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  const nestedId = await ensureFolderRow(env, owner.id, "Area/Projects");
  assert.ok(nestedId);

  const adopted = await enablePara(
    env,
    { resolutions: { projects: { action: "adopt", folderId: nestedId } } },
    owner,
  );
  assert.equal(adopted.kind, "invalid");

  const renamed = await enablePara(
    env,
    {
      resolutions: {
        projects: { action: "rename", folderId: nestedId, newName: "x" },
      },
    },
    owner,
  );
  assert.equal(renamed.kind, "invalid");
});

test("enablePara rejects adopt of an already bucket-assigned folder", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  await enablePara(env, {}, owner);
  const projectsId = folderRow(sqlite, owner.id, "Projects")?.id;
  assert.ok(projectsId);

  const result = await enablePara(
    env,
    { resolutions: { areas: { action: "adopt", folderId: projectsId } } },
    owner,
  );
  assert.equal(result.kind, "invalid");
});

test("enablePara rejects a rename with an invalid new name", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  const projectId = await ensureFolderRow(env, owner.id, "Projects");
  assert.ok(projectId);

  for (const newName of ["", "a/b", ".."]) {
    const result = await enablePara(
      env,
      {
        resolutions: {
          projects: { action: "rename", folderId: projectId, newName },
        },
      },
      owner,
    );
    assert.equal(result.kind, "invalid", `newName=${newName}`);
  }
});

test("enablePara rejects two resolutions targeting the same folder", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());

  const projectId = await ensureFolderRow(env, owner.id, "Projects");
  assert.ok(projectId);

  const result = await enablePara(
    env,
    {
      resolutions: {
        areas: { action: "adopt", folderId: projectId },
        projects: { action: "adopt", folderId: projectId },
      },
    },
    owner,
  );
  assert.equal(result.kind, "invalid");
});

test("enablePara requires a signed-in user", async (t) => {
  const { env, sqlite } = await createEnv();
  t.after(() => sqlite.close());
  const result = await enablePara(env, {}, undefined);
  assert.equal(result.kind, "denied");
});

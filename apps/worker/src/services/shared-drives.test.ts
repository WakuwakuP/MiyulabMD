import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { upsertUserByEmail } from "../db/users.ts";
import { listPublicSharedFolders, listSharedFolders } from "./access.ts";
import { moveFolder } from "./move.ts";
import { createNoteService } from "./notes.ts";
import {
  addDriveDomain,
  createSharedDrive,
  getSharedDrive,
  inviteDriveMember,
  listDriveMembers,
  listSharedDrives,
  removeDriveMember,
  updateDriveMemberRole,
} from "./shared-drives.ts";

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
  "0016_para_spaces.sql",
  "0017_medallion_sets_edit_lock.sql",
  "0018_scheme_root.sql",
  "0021_shared_drives.sql",
  "0022_shared_drive_domains.sql",
];

function applyMigrations(db: DatabaseSync): void {
  for (const migration of MIGRATIONS) {
    db.exec(
      readFileSync(
        new URL(`../db/migrations/${migration}`, import.meta.url),
        "utf8",
      ),
    );
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
  const editor = await upsertUserByEmail(env, "editor@example.com", "Editor");
  const viewer = await upsertUserByEmail(env, "viewer@example.com", "Viewer");
  const stranger = await upsertUserByEmail(
    env,
    "stranger@example.com",
    "Stranger",
  );
  return { editor, env, owner, sqlite, stranger, viewer };
}

test("non-members cannot see a shared drive and roles map to flags", async (t) => {
  const { editor, env, owner, sqlite, stranger, viewer } = await createEnv();
  t.after(() => sqlite.close());
  const created = await createSharedDrive(env, owner, "研究室");
  assert.equal(created.kind, "ok");
  if (created.kind !== "ok") {
    return;
  }
  assert.deepEqual(await getSharedDrive(env, created.result.id, stranger), {
    kind: "not_found",
  });

  const invitedEditor = await inviteDriveMember(
    env,
    created.result.id,
    editor.email,
    "editor",
    owner,
  );
  const invitedViewer = await inviteDriveMember(
    env,
    created.result.id,
    viewer.email,
    "viewer",
    owner,
  );
  assert.equal(invitedEditor.kind, "ok");
  assert.equal(invitedViewer.kind, "ok");

  const notes = createNoteService(env);
  const note = await notes.create(editor, {
    folderId: created.result.rootFolderId,
    markdown: "# 共有",
  });
  assert.ok(!("error" in note));
  if ("error" in note) {
    return;
  }
  assert.equal(note.ownerId, created.result.id);
  assert.equal(note.ownerKind, "shared_drive");
  assert.equal(note.access.flags.canAdmin, false);
  assert.equal(note.access.flags.canEdit, true);
  const listed = await notes.listForUser(editor);
  assert.equal(
    listed.some((item) => item.id === note.id),
    true,
  );
  const strangerList = await notes.listForUser(stranger);
  assert.equal(
    strangerList.some((item) => item.id === note.id),
    false,
  );

  const asViewer = await notes.get(note.id, viewer);
  assert.equal(asViewer.kind, "ok");
  if (asViewer.kind !== "ok") {
    return;
  }
  assert.deepEqual(asViewer.note.access.flags, {
    canAdmin: false,
    canEdit: false,
    canView: true,
  });

  const asOwner = await notes.get(note.id, owner);
  assert.equal(asOwner.kind, "ok");
  if (asOwner.kind !== "ok") {
    return;
  }
  assert.equal(asOwner.note.access.flags.canAdmin, true);

  const hidden = await notes.get(note.id, stranger);
  assert.equal(hidden.kind, "not_found");

  const refused = await notes.create(viewer, {
    folderId: created.result.rootFolderId,
    markdown: "# 不可",
  });
  assert.ok("error" in refused);
});

test("the last manager cannot be demoted or removed", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());
  const created = await createSharedDrive(env, owner, "研究室");
  assert.equal(created.kind, "ok");
  if (created.kind !== "ok") {
    return;
  }
  const members = await listDriveMembers(env, created.result.id, owner);
  assert.equal(members.kind, "ok");
  if (members.kind !== "ok") {
    return;
  }
  const manager = members.result[0];
  assert.ok(manager);
  const demoted = await updateDriveMemberRole(
    env,
    created.result.id,
    manager.id,
    "editor",
    owner,
  );
  assert.equal(demoted.kind, "invalid");
  const removed = await removeDriveMember(
    env,
    created.result.id,
    manager.id,
    owner,
  );
  assert.equal(removed.kind, "invalid");
});

test("drive subjects stay out of shared and public folder lists", async (t) => {
  const { env, owner, sqlite, viewer } = await createEnv();
  t.after(() => sqlite.close());
  const notes = createNoteService(env);
  const created = await notes.create(owner, {
    folder: "公開箱",
    markdown: "# 公開",
  });
  assert.ok(!("error" in created));
  if ("error" in created) {
    return;
  }
  const folderId = (
    sqlite
      .prepare("SELECT id FROM folders WHERE owner_id = ? AND folder = ?")
      .get(owner.id, "公開箱") as { id: string }
  ).id;
  sqlite
    .prepare(
      "UPDATE notes SET read_scope = 'public', write_scope = 'self' WHERE id = ?",
    )
    .run(created.id);
  sqlite
    .prepare(
      `INSERT INTO folder_policies (owner_id, folder, read_scope, write_scope, updated_at)
       VALUES (?, '公開箱', 'public', 'self', ?)`,
    )
    .run(owner.id, Date.now());

  assert.equal(
    (await listPublicSharedFolders(env)).some(
      (folder) => folder.id === folderId,
    ),
    true,
  );

  const drive = await createSharedDrive(env, owner, "研究室");
  assert.equal(drive.kind, "ok");
  if (drive.kind !== "ok") {
    return;
  }
  const moved = await moveFolder(
    env,
    folderId,
    { destFolderId: drive.result.rootFolderId },
    owner,
  );
  assert.equal(moved.kind, "ok");
  const row = sqlite
    .prepare(
      "SELECT owner_id, owner_kind, read_scope, write_scope FROM notes WHERE id = ?",
    )
    .get(created.id) as {
    owner_id: string;
    owner_kind: string;
    read_scope: string;
    write_scope: string;
  };
  assert.equal(row.owner_id, drive.result.id);
  assert.equal(row.owner_kind, "shared_drive");
  assert.equal(row.read_scope, "self");
  assert.equal(row.write_scope, "self");
  assert.equal(
    (await listPublicSharedFolders(env)).some(
      (folder) => folder.name === "公開箱",
    ),
    false,
  );
  assert.equal(
    (await listSharedFolders(env, viewer)).some(
      (folder) => folder.name === "公開箱",
    ),
    false,
  );
});

test("space roots and scheme roots cannot change subject", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());
  const notes = createNoteService(env);
  await notes.create(owner, { folder: "スペース", markdown: "# s" });
  await notes.create(owner, { folder: "採番", markdown: "# n" });
  const spaceId = (
    sqlite
      .prepare("SELECT id FROM folders WHERE folder = ?")
      .get("スペース") as { id: string }
  ).id;
  const schemeId = (
    sqlite.prepare("SELECT id FROM folders WHERE folder = ?").get("採番") as {
      id: string;
    }
  ).id;
  sqlite
    .prepare(
      `INSERT INTO para_spaces (id, owner_id, name, root_folder_id, created_at)
       VALUES ('space-1', ?, '研究', ?, ?)`,
    )
    .run(owner.id, spaceId, Date.now());
  sqlite
    .prepare("UPDATE folders SET scheme = 'jd', scheme_id = NULL WHERE id = ?")
    .run(schemeId);
  const drive = await createSharedDrive(env, owner, "研究室");
  assert.equal(drive.kind, "ok");
  if (drive.kind !== "ok") {
    return;
  }
  const spaceMove = await moveFolder(
    env,
    spaceId,
    { destFolderId: drive.result.rootFolderId },
    owner,
  );
  const schemeMove = await moveFolder(
    env,
    schemeId,
    { destFolderId: drive.result.rootFolderId },
    owner,
  );
  assert.equal(spaceMove.kind, "invalid");
  assert.equal(schemeMove.kind, "invalid");
  if (spaceMove.kind === "invalid") {
    assert.match(spaceMove.error, /スペースルート/);
  }
  if (schemeMove.kind === "invalid") {
    assert.match(schemeMove.error, /採番スコープ/);
  }
});

test("a cross-subject move strips subject-bound attributes", async (t) => {
  const { env, owner, sqlite, viewer } = await createEnv();
  t.after(() => sqlite.close());
  const notes = createNoteService(env);
  const note = await notes.create(owner, {
    folder: "仕事/メモ",
    markdown: "# m",
  });
  assert.ok(!("error" in note));
  if ("error" in note) {
    return;
  }
  const folderId = (
    sqlite.prepare("SELECT id FROM folders WHERE folder = ?").get("仕事") as {
      id: string;
    }
  ).id;
  sqlite
    .prepare(
      `INSERT INTO medallion_sets (id, owner_user_id, name, layers, created_at)
       VALUES ('set-1', ?, '層', '[]', ?)`,
    )
    .run(owner.id, Date.now());
  sqlite
    .prepare(
      `UPDATE folders
          SET medallion_set_id = 'set-1', medallion_layer = 'bronze',
              para_bucket = 'projects', scheme_id = '10', scheme_title = '仕事'
        WHERE id = ?`,
    )
    .run(folderId);
  sqlite
    .prepare(
      `INSERT INTO folder_policies (owner_id, folder, read_scope, write_scope, updated_at)
       VALUES (?, '仕事', 'signed_in', 'self', ?)`,
    )
    .run(owner.id, Date.now());
  sqlite
    .prepare(
      `INSERT INTO access_grants
         (id, owner_id, target_kind, target_key, email, user_id, can_write, created_at)
       VALUES ('grant-1', ?, 'folder', '仕事', ?, ?, 0, ?)`,
    )
    .run(owner.id, viewer.email, viewer.id, Date.now());

  const drive = await createSharedDrive(env, owner, "研究室");
  assert.equal(drive.kind, "ok");
  if (drive.kind !== "ok") {
    return;
  }
  const dry = await moveFolder(
    env,
    folderId,
    { destFolderId: drive.result.rootFolderId, dryRun: true },
    owner,
  );
  assert.equal(dry.kind, "ok");
  if (dry.kind !== "ok") {
    return;
  }
  assert.equal(dry.result.plan.stripped?.medallion, 1);
  assert.equal(dry.result.plan.stripped?.para, 1);
  assert.equal(dry.result.plan.stripped?.scheme, 1);
  assert.ok((dry.result.plan.stripped?.policies ?? 0) >= 1);
  assert.ok((dry.result.plan.stripped?.grants ?? 0) >= 1);

  const moved = await moveFolder(
    env,
    folderId,
    { destFolderId: drive.result.rootFolderId },
    owner,
  );
  assert.equal(moved.kind, "ok");
  const folder = sqlite
    .prepare(
      `SELECT owner_id, owner_kind, medallion_set_id, para_bucket, scheme_id
         FROM folders WHERE id = ?`,
    )
    .get(folderId) as {
    owner_id: string;
    owner_kind: string;
    medallion_set_id: string | null;
    para_bucket: string | null;
    scheme_id: string | null;
  };
  assert.equal(folder.owner_id, drive.result.id);
  assert.equal(folder.owner_kind, "shared_drive");
  assert.equal(folder.medallion_set_id, null);
  assert.equal(folder.para_bucket, null);
  assert.equal(folder.scheme_id, null);
  const grant = sqlite
    .prepare(
      "SELECT COUNT(*) AS c FROM access_grants WHERE target_key = '仕事'",
    )
    .get() as { c: number };
  assert.equal(grant.c, 0);
});

test("a matching email domain joins the drive on login", async (t) => {
  const { env, owner, sqlite, viewer } = await createEnv();
  t.after(() => sqlite.close());
  const created = await createSharedDrive(env, owner, "研究室");
  assert.equal(created.kind, "ok");
  if (created.kind !== "ok") {
    return;
  }
  const driveId = created.result.id;
  const added = await addDriveDomain(
    env,
    driveId,
    "@example.com",
    "editor",
    owner,
  );
  assert.equal(added.kind, "ok");
  if (added.kind !== "ok") {
    return;
  }
  assert.equal(added.result[0]?.domain, "example.com");
  assert.equal(added.result[0]?.role, "editor");

  const duplicate = await addDriveDomain(
    env,
    driveId,
    "example.com",
    "viewer",
    owner,
  );
  assert.equal(duplicate.kind, "invalid");
  const invalid = await addDriveDomain(
    env,
    driveId,
    "example",
    "editor",
    owner,
  );
  assert.equal(invalid.kind, "invalid");
  const outsider = {
    displayName: "Out",
    email: "out@elsewhere.test",
    id: "outsider",
  };
  const hidden = await addDriveDomain(
    env,
    driveId,
    "elsewhere.test",
    "viewer",
    outsider,
  );
  assert.deepEqual(hidden, { kind: "not_found" });

  const joined = await upsertUserByEmail(env, "new@example.com", "New");
  const drives = await listSharedDrives(env, joined);
  assert.equal(
    drives.some((drive) => drive.id === driveId && drive.role === "editor"),
    true,
  );
  const nested = await upsertUserByEmail(
    env,
    "person@lab.example.com",
    "Nested",
  );
  const nestedDrives = await listSharedDrives(env, nested);
  assert.equal(
    nestedDrives.some((drive) => drive.id === driveId),
    false,
  );

  const invited = await inviteDriveMember(
    env,
    driveId,
    viewer.email,
    "viewer",
    owner,
  );
  assert.equal(invited.kind, "ok");
  await upsertUserByEmail(env, viewer.email, "Viewer");
  const kept = await listSharedDrives(env, viewer);
  assert.equal(kept.find((drive) => drive.id === driveId)?.role, "viewer");
  const asViewer = await addDriveDomain(
    env,
    driveId,
    "elsewhere.test",
    "editor",
    viewer,
  );
  assert.deepEqual(asViewer, { kind: "denied", status: 403 });
});

test("removing a domain member keeps them out until they are invited again", async (t) => {
  const { env, owner, sqlite } = await createEnv();
  t.after(() => sqlite.close());
  const created = await createSharedDrive(env, owner, "研究室");
  assert.equal(created.kind, "ok");
  if (created.kind !== "ok") {
    return;
  }
  const driveId = created.result.id;
  assert.equal(
    (await addDriveDomain(env, driveId, "example.com", "editor", owner)).kind,
    "ok",
  );
  const joined = await upsertUserByEmail(env, "new@example.com", "New");
  const members = await listDriveMembers(env, driveId, owner);
  assert.equal(members.kind, "ok");
  if (members.kind !== "ok") {
    return;
  }
  const row = members.result.find((member) => member.email === joined.email);
  assert.ok(row);
  if (!row) {
    return;
  }
  assert.equal(
    (await removeDriveMember(env, driveId, row.id, owner)).kind,
    "ok",
  );
  await upsertUserByEmail(env, joined.email, "New");
  const absent = await listSharedDrives(env, joined);
  assert.equal(
    absent.some((drive) => drive.id === driveId),
    false,
  );
  assert.equal(
    (await inviteDriveMember(env, driveId, joined.email, "viewer", owner)).kind,
    "ok",
  );
  const back = await listSharedDrives(env, joined);
  assert.equal(back.find((drive) => drive.id === driveId)?.role, "viewer");
});

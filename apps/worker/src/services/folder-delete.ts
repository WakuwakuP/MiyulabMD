import {
  type NoteHistoryActor,
  normalizeFolder,
  normalizeFolderDeletionSettings,
  type SessionUser,
} from "@miyulabmd/shared";
import { db } from "../db/client.ts";
import { actorFromSessionUser } from "../durable-objects/history-edit.ts";
import { folderSubtreeFilter } from "./folder-path-sql.ts";

export type DeleteEmptyFolderInput = {
  folder_id?: string;
  path?: string;
  expected_path?: string;
  dry_run?: boolean;
};
type Counts = {
  notes: number;
  subfolders: number;
  articleSources: number;
  lockedNotes: number;
};
type Folder = {
  id: string;
  owner_id: string;
  folder: string;
  created_at: number;
  para_bucket: string | null;
  para_space_id: string | null;
  scheme: string | null;
  scheme_id: string | null;
  scheme_title: string | null;
  scheme_root: string | null;
  medallion_set_id: string | null;
  medallion_layer: string | null;
};
type Snapshot = {
  folder: Folder;
  policy: Record<string, unknown> | null;
  grants: Record<string, unknown>[];
};
export type DeleteEmptyFolderOutcome =
  | {
      kind: "ok";
      result: {
        deleted: boolean;
        canDelete: true;
        dryRun: boolean;
        folder: { id: string; path: string; parentId: string | null };
        removed: { folderRows: number; policies: number; grants: number };
        metadata: {
          policy: boolean;
          grants: number;
          scheme: boolean;
          medallion: boolean;
        };
        auditId: string | null;
      };
    }
  | {
      kind: "error";
      error: string;
      status: number;
      counts?: Counts;
      currentPath?: string;
    };

function failure(error: string, status = 409): DeleteEmptyFolderOutcome {
  return { error, kind: "error", status };
}

/** Polynomial-time glob matching, without regular-expression backtracking. */
function matchSequence(
  values: string[],
  tokens: string[],
  wildcard: string,
  matches: (value: string, token: string) => boolean,
): boolean {
  let state = new Array<boolean>(values.length + 1).fill(false);
  state[0] = true;
  for (const token of tokens) {
    const next = new Array<boolean>(values.length + 1).fill(false);
    const isWildcard = token === wildcard;
    next[0] = isWildcard && state[0] === true;
    for (let i = 1; i <= values.length; i++) {
      next[i] = isWildcard
        ? state[i] === true || next[i - 1] === true
        : state[i - 1] === true && matches(values[i - 1] ?? "", token);
    }
    state = next;
  }
  return state[values.length] === true;
}
/** Anchored segment globs: * stays in a segment; ** spans zero or more segments. */
function protectedPathMatches(path: string, pattern: string): boolean {
  return matchSequence(
    path.split("/"),
    pattern.split("/"),
    "**",
    (value, token) =>
      matchSequence(
        Array.from(value),
        Array.from(token),
        "*",
        (a, b) => a === b,
      ),
  );
}

function settingsProtect(raw: string | null, row: Folder): boolean {
  if (!raw) {
    return false;
  }
  try {
    const settings = JSON.parse(raw);
    const config = normalizeFolderDeletionSettings(settings?.folderDeletion);
    return (
      config.protectedFolderIds.includes(row.id) ||
      config.protectedPathPatterns.some((pattern) =>
        protectedPathMatches(row.folder, pattern),
      )
    );
  } catch {
    // Corrupt settings cannot safely establish that deletion is allowed.
    return true;
  }
}

const snapshotSql = `json_object(
  'folder', json_object('id', f.id, 'owner_id', f.owner_id, 'folder', f.folder,
    'created_at', f.created_at, 'para_bucket', f.para_bucket, 'para_space_id', f.para_space_id,
    'scheme', f.scheme, 'scheme_id', f.scheme_id, 'scheme_title', f.scheme_title,
    'scheme_root', f.scheme_root, 'medallion_set_id', f.medallion_set_id, 'medallion_layer', f.medallion_layer),
  'policy', (SELECT json_object('owner_id', p.owner_id, 'folder', p.folder,
    'read_scope', p.read_scope, 'write_scope', p.write_scope, 'updated_at', p.updated_at)
    FROM folder_policies p WHERE p.owner_id = f.owner_id AND p.folder = f.folder),
  'grants', json((SELECT json_group_array(json_object('id', g.id, 'owner_id', g.owner_id,
    'target_kind', g.target_kind, 'target_key', g.target_key, 'email', g.email, 'user_id', g.user_id,
    'can_write', g.can_write, 'created_at', g.created_at)) FROM access_grants g
    WHERE g.owner_id = f.owner_id AND g.target_kind = 'folder' AND g.target_key = f.folder)))`;

async function inspect(env: Env, row: Folder) {
  const filter = folderSubtreeFilter(row.folder);
  // One SQLite read snapshot: never mix counts from an old path with metadata
  // from a later rename. Pin owner/path, then report any changed target safely.
  const details = await db(env)
    .prepare(`SELECT
    (SELECT count(*) FROM notes WHERE owner_id = ? AND ${filter.sql}) AS notes,
    (SELECT count(*) FROM folders WHERE owner_id = ? AND id != ? AND ${filter.sql}) AS subfolders,
    (SELECT count(*) FROM article_sources WHERE owner_id = ? AND ${filter.sql}) AS articleSources,
    (SELECT count(*) FROM notes WHERE owner_id = ? AND edit_locked = 1 AND ${filter.sql}) AS lockedNotes,
    u.settings,
    EXISTS(SELECT 1 FROM para_spaces WHERE root_folder_id = f.id) AS spaceRoot,
    (SELECT id FROM folders WHERE owner_id = f.owner_id AND folder = ?) AS parentId,
    ${snapshotSql} AS snapshot FROM folders f JOIN users u ON u.id = f.owner_id
    WHERE f.id = ? AND f.owner_id = ? AND f.folder = ?`)
    .bind(
      row.owner_id,
      ...filter.binds,
      row.owner_id,
      row.id,
      ...filter.binds,
      row.owner_id,
      ...filter.binds,
      row.owner_id,
      ...filter.binds,
      parentPath(row.folder),
      row.id,
      row.owner_id,
      row.folder,
    )
    .first<
      Counts & {
        settings: string | null;
        spaceRoot: number;
        parentId: string | null;
        snapshot: string;
      }
    >();
  const counts = {
    articleSources: details?.articleSources ?? 0,
    lockedNotes: details?.lockedNotes ?? 0,
    notes: details?.notes ?? 0,
    subfolders: details?.subfolders ?? 0,
  };
  return { counts, details };
}

function parentPath(path: string) {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}
function isProtected(
  row: Folder,
  details: { settings: string | null; spaceRoot: number },
) {
  return (
    row.folder === "" ||
    row.para_bucket !== null ||
    details.spaceRoot !== 0 ||
    (row.scheme !== null && row.scheme_id === null) ||
    settingsProtect(details.settings, row)
  );
}
function nonempty(counts: Counts) {
  return Object.values(counts).some((count) => count > 0);
}
function ok(
  row: Folder,
  parentId: string | null,
  snapshot: Snapshot,
  dryRun: boolean,
  auditId: string | null,
): DeleteEmptyFolderOutcome {
  return {
    kind: "ok",
    result: {
      auditId,
      canDelete: true,
      deleted: !dryRun,
      dryRun,
      folder: { id: row.id, parentId, path: row.folder },
      metadata: {
        grants: snapshot.grants.length,
        medallion: row.medallion_set_id !== null,
        policy: snapshot.policy !== null,
        scheme: row.scheme !== null || row.scheme_id !== null,
      },
      removed: {
        folderRows: 1,
        grants: snapshot.grants.length,
        policies: snapshot.policy ? 1 : 0,
      },
    },
  };
}

/** One folder only. Query/batch count is independent of depth and subtree size;
 * COUNT scans are indexed ranges, not constant-time operations. No recursive
 * deletion, note reads, implicit folder creation, or lazy settings migration. */
export async function deleteEmptyFolder(
  env: Env,
  input: DeleteEmptyFolderInput,
  user: SessionUser | undefined,
  actor?: NoteHistoryActor,
): Promise<DeleteEmptyFolderOutcome> {
  if (!user) {
    return failure("denied", 401);
  }
  const target = await resolveTarget(env, input, user);
  if ("kind" in target) {
    return target;
  }
  const { counts, details } = await inspect(env, target);
  if (!details) {
    return await explainFailedDelete(env, target, user);
  }
  const row: Folder = JSON.parse(details.snapshot).folder;
  if (isProtected(row, details)) {
    return failure("protected_folder");
  }
  if (nonempty(counts)) {
    return { counts, error: "folder_not_empty", kind: "error", status: 409 };
  }
  if (input.dry_run) {
    return ok(row, details.parentId, JSON.parse(details.snapshot), true, null);
  }
  const author = actor ?? actorFromSessionUser(user);
  if (
    author.userId !== user.id ||
    (author.kind !== "user" && author.kind !== "agent")
  ) {
    return failure("denied", 403);
  }
  const auditId = crypto.randomUUID();
  const filter = folderSubtreeFilter(row.folder);
  const eligible = `f.id = ? AND f.owner_id = ? AND f.folder = ? AND f.folder != ''
    AND f.para_bucket IS NULL AND NOT (f.scheme IS NOT NULL AND f.scheme_id IS NULL)
    AND NOT EXISTS (SELECT 1 FROM para_spaces WHERE root_folder_id = f.id)
    AND EXISTS (SELECT 1 FROM users WHERE id = f.owner_id AND settings IS ?)
    AND NOT EXISTS (SELECT 1 FROM notes WHERE owner_id = ? AND ${filter.sql})
    AND NOT EXISTS (SELECT 1 FROM folders WHERE owner_id = ? AND id != ? AND ${filter.sql})
    AND NOT EXISTS (SELECT 1 FROM article_sources WHERE owner_id = ? AND ${filter.sql})`;
  const binds = [
    row.id,
    row.owner_id,
    row.folder,
    details.settings,
    row.owner_id,
    ...filter.binds,
    row.owner_id,
    row.id,
    ...filter.binds,
    row.owner_id,
    ...filter.binds,
  ];
  // The candidate audit is made from live rows INSIDE the transaction. Every
  // subsequent side effect requires it, and metadata also requires actual
  // absence of the original UUID. A zero-row DELETE must never strip metadata.
  // A suppressed DELETE (e.g. a trigger) removes the candidate audit again.
  const deleted = `EXISTS (SELECT 1 FROM folder_delete_events WHERE id = ?)
    AND NOT EXISTS (SELECT 1 FROM folders WHERE id = ?)`;
  const result = await db(env).batch([
    db(env)
      .prepare(`INSERT INTO folder_delete_events
      (id, owner_id, folder_id, path, parent_path, actor_kind, actor_user_id, actor_name, deleted_at, snapshot)
      SELECT ?, f.owner_id, f.id, f.folder, ?, ?, ?, ?, ?, ${snapshotSql}
      FROM folders f WHERE ${eligible}`)
      .bind(
        auditId,
        parentPath(row.folder),
        author.kind,
        author.userId,
        author.name,
        Date.now(),
        ...binds,
      ),
    db(env)
      .prepare(`DELETE FROM folders AS f WHERE ${eligible}
      AND EXISTS (SELECT 1 FROM folder_delete_events WHERE id = ?)`)
      .bind(...binds, auditId),
    db(env)
      .prepare(
        `DELETE FROM folder_policies WHERE owner_id = ? AND folder = ? AND ${deleted}`,
      )
      .bind(row.owner_id, row.folder, auditId, row.id),
    db(env)
      .prepare(
        `DELETE FROM access_grants WHERE owner_id = ? AND target_kind = 'folder' AND target_key = ? AND ${deleted}`,
      )
      .bind(row.owner_id, row.folder, auditId, row.id),
    db(env)
      .prepare(
        "DELETE FROM folder_delete_events WHERE id = ? AND EXISTS (SELECT 1 FROM folders WHERE id = ?)",
      )
      .bind(auditId, row.id),
  ]);
  if (result[1]?.meta.changes === 1) {
    const event = await db(env)
      .prepare("SELECT snapshot FROM folder_delete_events WHERE id = ?")
      .bind(auditId)
      .first<{ snapshot: string }>();
    if (!event) {
      throw new Error("Folder deletion audit missing");
    }
    const snapshot: Snapshot = JSON.parse(event.snapshot);
    return ok(snapshot.folder, details.parentId, snapshot, false, auditId);
  }
  return await explainFailedDelete(env, row, user);
}

async function explainFailedDelete(
  env: Env,
  row: Folder,
  user: SessionUser,
): Promise<DeleteEmptyFolderOutcome> {
  // Re-read only, never retry a destructive statement after a failed guard.
  const current = await db(env)
    .prepare("SELECT * FROM folders WHERE id = ?")
    .bind(row.id)
    .first<Folder>();
  if (!current) {
    return failure("not_found", 404);
  }
  if (current.owner_id !== user.id) {
    return failure("denied", 403);
  }
  if (current.folder !== row.folder) {
    return {
      currentPath: current.folder,
      error: "path_mismatch",
      kind: "error",
      status: 409,
    };
  }
  const fresh = await inspect(env, current);
  if (!fresh.details) {
    return failure("not_found", 404);
  }
  if (isProtected(JSON.parse(fresh.details.snapshot).folder, fresh.details)) {
    return failure("protected_folder");
  }
  if (nonempty(fresh.counts)) {
    return {
      counts: fresh.counts,
      error: "folder_not_empty",
      kind: "error",
      status: 409,
    };
  }
  return failure("state_changed");
}

async function resolveTarget(
  env: Env,
  input: DeleteEmptyFolderInput,
  user: SessionUser,
): Promise<Folder | DeleteEmptyFolderOutcome> {
  if (
    (!input.folder_id && input.path === undefined) ||
    input.folder_id === ""
  ) {
    return failure("ambiguous_target", 400);
  }
  const path =
    input.path === undefined ? undefined : normalizeFolder(input.path);
  if (path === "") {
    return failure("protected_folder");
  }
  const row = input.folder_id
    ? await db(env)
        .prepare("SELECT * FROM folders WHERE id = ?")
        .bind(input.folder_id)
        .first<Folder>()
    : await db(env)
        .prepare("SELECT * FROM folders WHERE owner_id = ? AND folder = ?")
        .bind(user.id, path ?? "")
        .first<Folder>();
  if (!row) {
    return failure("not_found", 404);
  }
  if (row.owner_id !== user.id) {
    return failure("denied", 403);
  }
  if (path !== undefined && row.folder !== path) {
    return failure("ambiguous_target", 400);
  }
  if (input.expected_path !== undefined && input.expected_path !== row.folder) {
    return {
      currentPath: row.folder,
      error: "path_mismatch",
      kind: "error",
      status: 409,
    };
  }
  return row;
}

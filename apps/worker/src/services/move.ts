import {
  folderContains,
  MOVE_MAX_ITEMS,
  type MoveFolderContentsResult,
  type MoveFolderItem,
  type MoveFolderResult,
  type MoveNoteItem,
  type MoveNotesResult,
  type MovePlan,
  normalizeFolder,
  type OwnerKind,
  type SessionUser,
  translateArticleUpdateAudience,
} from "@miyulabmd/shared";

import { db } from "../db/client.ts";
import {
  ensureFolderStatements,
  folderName,
  getFolderById,
  getFolderByPath,
  parentFolderPath,
  resolveNoteAccess,
} from "./access.ts";
import {
  canEditSubject,
  driveRoleFor,
  isSharedDrive,
  markDriveFolderKinds,
} from "./drive-membership.ts";
import {
  folderDirectChildrenFilter,
  folderRewriteAssignment,
  folderSubtreeFilter,
} from "./folder-path-sql.ts";
import {
  accessFields,
  findNoteRow,
  lockedNotesInFolder,
  NOTE_COLUMNS,
  type NoteRow,
  relocateFolderTree,
} from "./notes.ts";

export type MoveError =
  | { kind: "not_found" }
  | { kind: "denied"; status: 401 | 403 }
  | { kind: "invalid"; error: string; status: number };

type MoveOk<T> = { kind: "ok"; result: T };

type DestFolder = {
  id: string | null;
  folder: string;
  owner_id: string;
  owner_kind: "user" | "shared_drive";
};

function invalid(error: string, status = 400): MoveError {
  return { error, kind: "invalid", status };
}

async function sourceDenied(
  env: Env,
  ownerId: string,
  user: SessionUser | undefined,
): Promise<MoveError | null> {
  if (!user) {
    return { kind: "denied", status: 401 };
  }
  if (!(await canEditSubject(env, ownerId, user))) {
    return { kind: "denied", status: 403 };
  }
  return null;
}

/**
 * Resolve the destination folder. `null`/omitted means the caller's my-drive root.
 * A shared drive the caller can edit is a valid destination.
 */
async function resolveDest(
  env: Env,
  destFolderId: string | null | undefined,
  user: SessionUser | undefined,
): Promise<DestFolder | MoveError> {
  if (!user) {
    return { kind: "denied", status: 401 };
  }
  if (destFolderId === null || destFolderId === undefined) {
    return {
      folder: "",
      id: null,
      owner_id: user.id,
      owner_kind: "user",
    };
  }
  const rec = await getFolderById(env, destFolderId);
  if (!rec) {
    return { kind: "not_found" };
  }
  if (!(await canEditSubject(env, rec.owner_id, user))) {
    return { kind: "denied", status: 403 };
  }
  return {
    ...rec,
    owner_kind: (await isSharedDrive(env, rec.owner_id))
      ? "shared_drive"
      : "user",
  };
}

async function countQuery(
  env: Env,
  sql: string,
  ...params: Array<string | number>
): Promise<number> {
  const row = await db(env)
    .prepare(sql)
    .bind(...params)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

/** Count every entity whose path lives inside `path` (inclusive). */
async function countSubtree(
  env: Env,
  ownerId: string,
  path: string,
): Promise<MovePlan> {
  const subtree = folderSubtreeFilter(path);
  const grants = folderSubtreeFilter(path, "target_key");
  const [notes, folders, policies, grantsCount, articleSources] =
    await Promise.all([
      countQuery(
        env,
        `SELECT COUNT(*) AS c FROM notes WHERE owner_id = ? AND ${subtree.sql}`,
        ownerId,
        ...subtree.binds,
      ),
      countQuery(
        env,
        `SELECT COUNT(*) AS c FROM folders WHERE owner_id = ? AND ${subtree.sql}`,
        ownerId,
        ...subtree.binds,
      ),
      countQuery(
        env,
        `SELECT COUNT(*) AS c FROM folder_policies WHERE owner_id = ? AND ${subtree.sql}`,
        ownerId,
        ...subtree.binds,
      ),
      countQuery(
        env,
        `SELECT COUNT(*) AS c FROM access_grants WHERE owner_id = ? AND target_kind = 'folder' AND ${grants.sql}`,
        ownerId,
        ...grants.binds,
      ),
      countQuery(
        env,
        `SELECT COUNT(*) AS c FROM article_sources WHERE owner_id = ? AND ${subtree.sql}`,
        ownerId,
        ...subtree.binds,
      ),
    ]);
  return {
    articleSources,
    folders,
    grants: grantsCount,
    notes,
    policies,
  };
}

function exceedsLimit(plan: MovePlan): boolean {
  return plan.notes + plan.folders > MOVE_MAX_ITEMS;
}

function limitError(): MoveError {
  return invalid(
    `1 回の移動は ${MOVE_MAX_ITEMS} 件（ノート＋フォルダ）までです`,
    400,
  );
}

export type MoveFolderInput = {
  /** Destination folder UUID; null/omitted moves to the drive root. */
  destFolderId?: string | null;
  /** Optional rename applied while moving. */
  name?: string;
  dryRun?: boolean;
};

async function blockedRootReason(
  env: Env,
  ownerId: string,
  path: string,
): Promise<string | null> {
  const subtree = folderSubtreeFilter(path);
  const space = await db(env)
    .prepare(
      `SELECT 1 AS ok FROM folders f
         JOIN para_spaces p ON p.root_folder_id = f.id
        WHERE f.owner_id = ? AND ${subtree.sql}
        LIMIT 1`,
    )
    .bind(ownerId, ...subtree.binds)
    .first<{ ok: number }>();
  if (space) {
    return "スペースルートは、割当を解いてから移動してください";
  }
  const scheme = await db(env)
    .prepare(
      `SELECT 1 AS ok FROM folders
        WHERE owner_id = ? AND ${subtree.sql}
          AND scheme IS NOT NULL
          AND (scheme_id IS NULL OR scheme_id = '')
        LIMIT 1`,
    )
    .bind(ownerId, ...subtree.binds)
    .first<{ ok: number }>();
  return scheme ? "採番スコープの根は、割当を解いてから移動してください" : null;
}

async function strippedCounts(env: Env, ownerId: string, path: string) {
  const subtree = folderSubtreeFilter(path);
  const grants = folderSubtreeFilter(path, "target_key");
  const [medallion, para, scheme, policies, grantCount] = await Promise.all([
    countQuery(
      env,
      `SELECT COUNT(*) AS c FROM folders WHERE owner_id = ? AND medallion_set_id IS NOT NULL AND ${subtree.sql}`,
      ownerId,
      ...subtree.binds,
    ),
    countQuery(
      env,
      `SELECT COUNT(*) AS c FROM folders WHERE owner_id = ? AND (para_bucket IS NOT NULL OR para_space_id IS NOT NULL) AND ${subtree.sql}`,
      ownerId,
      ...subtree.binds,
    ),
    countQuery(
      env,
      `SELECT COUNT(*) AS c FROM folders WHERE owner_id = ? AND (scheme IS NOT NULL OR scheme_id IS NOT NULL OR scheme_root IS NOT NULL) AND ${subtree.sql}`,
      ownerId,
      ...subtree.binds,
    ),
    countQuery(
      env,
      `SELECT COUNT(*) AS c FROM folder_policies WHERE owner_id = ? AND ${subtree.sql}`,
      ownerId,
      ...subtree.binds,
    ),
    countQuery(
      env,
      `SELECT COUNT(*) AS c FROM access_grants WHERE owner_id = ? AND target_kind = 'folder' AND ${grants.sql}`,
      ownerId,
      ...grants.binds,
    ),
  ]);
  return { grants: grantCount, medallion, para, policies, scheme };
}

async function sourceOwnerKind(env: Env, ownerId: string): Promise<OwnerKind> {
  return (await isSharedDrive(env, ownerId)) ? "shared_drive" : "user";
}

async function listAudienceTranslations(
  env: Env,
  srcOwner: string,
  from: string,
  destKind: OwnerKind,
): Promise<Array<{ from: string; to: string }>> {
  const srcKind = await sourceOwnerKind(env, srcOwner);
  if (srcKind === destKind) {
    return [];
  }
  const subtree = folderSubtreeFilter(from);
  const rows = await db(env)
    .prepare(
      `SELECT DISTINCT update_audience AS audience
         FROM article_sources
        WHERE owner_id = ? AND ${subtree.sql}`,
    )
    .bind(srcOwner, ...subtree.binds)
    .all<{ audience: string | null }>();
  const seen = new Set<string>();
  const translations: Array<{ from: string; to: string }> = [];
  for (const row of rows.results ?? []) {
    const next = translateArticleUpdateAudience(
      srcKind,
      destKind,
      row.audience,
    );
    const key = `${row.audience ?? ""}:${next}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    translations.push({ from: row.audience ?? "self", to: next });
  }
  return translations;
}

async function transferFolderTree(
  env: Env,
  srcOwner: string,
  from: string,
  dest: DestFolder,
  to: string,
): Promise<void> {
  const d1 = db(env);
  const subtree = folderSubtreeFilter(from);
  const destSubtree = folderSubtreeFilter(to);
  const rewrite = folderRewriteAssignment(from, to);
  const grants = folderSubtreeFilter(from, "target_key");
  const srcKind = await sourceOwnerKind(env, srcOwner);
  await d1.batch([
    ...ensureFolderStatements(env, dest.owner_id, parentFolderPath(to)),
    d1
      .prepare(
        `DELETE FROM access_grants
          WHERE owner_id = ? AND target_kind = 'folder' AND ${grants.sql}`,
      )
      .bind(srcOwner, ...grants.binds),
    d1
      .prepare(
        `DELETE FROM folder_policies WHERE owner_id = ? AND ${subtree.sql}`,
      )
      .bind(srcOwner, ...subtree.binds),
    d1
      .prepare(
        `UPDATE folders
            SET owner_id = ?, owner_kind = ?, ${rewrite.sql},
                medallion_set_id = NULL, medallion_layer = NULL,
                para_bucket = NULL, para_space_id = NULL,
                scheme = NULL, scheme_id = NULL, scheme_title = NULL,
                scheme_root = NULL
          WHERE owner_id = ? AND ${subtree.sql}`,
      )
      .bind(
        dest.owner_id,
        dest.owner_kind,
        ...rewrite.binds,
        srcOwner,
        ...subtree.binds,
      ),
    d1
      .prepare(
        `UPDATE notes
            SET owner_id = ?, owner_kind = ?, ${rewrite.sql},
                read_scope = 'self', write_scope = 'self', permission = 'private',
                updated_at = ?
          WHERE owner_id = ? AND ${subtree.sql}`,
      )
      .bind(
        dest.owner_id,
        dest.owner_kind,
        ...rewrite.binds,
        Date.now(),
        srcOwner,
        ...subtree.binds,
      ),
    d1
      .prepare(
        `UPDATE article_sources
            SET owner_id = ?, ${rewrite.sql},
                update_audience = CASE
                  WHEN ? = 'user' AND ? = 'shared_drive' THEN
                    CASE update_audience
                      WHEN 'editors' THEN 'managers_or_editors'
                      ELSE 'managers'
                    END
                  WHEN ? = 'shared_drive' AND ? = 'user' THEN
                    CASE
                      WHEN update_audience IN ('managers_or_editors', 'editors')
                        THEN 'editors'
                      ELSE 'self'
                    END
                  ELSE update_audience
                END
          WHERE owner_id = ? AND ${subtree.sql}`,
      )
      .bind(
        dest.owner_id,
        ...rewrite.binds,
        srcKind,
        dest.owner_kind,
        srcKind,
        dest.owner_kind,
        srcOwner,
        ...subtree.binds,
      ),
    d1
      .prepare(
        `DELETE FROM access_grants
          WHERE target_kind = 'note'
            AND target_key IN (
              SELECT id FROM notes WHERE owner_id = ? AND ${destSubtree.sql}
            )`,
      )
      .bind(dest.owner_id, ...destSubtree.binds),
  ]);
  await markDriveFolderKinds(env, dest.owner_id);
}

export async function moveFolder(
  env: Env,
  folderId: string,
  input: MoveFolderInput,
  user: SessionUser | undefined,
): Promise<MoveError | MoveOk<MoveFolderResult>> {
  const src = await getFolderById(env, folderId);
  if (!src) {
    return { kind: "not_found" };
  }
  const denied = await sourceDenied(env, src.owner_id, user);
  if (denied) {
    return denied;
  }
  if (!src.folder) {
    return invalid("ドライブルートは移動できません");
  }
  const dest = await resolveDest(env, input.destFolderId, user);
  if ("kind" in dest) {
    return dest;
  }
  const sameSubject = dest.owner_id === src.owner_id;
  if (sameSubject && folderContains(src.folder, dest.folder)) {
    return invalid("移動先が移動元の配下です");
  }

  const name =
    input.name === undefined
      ? folderName(src.folder)
      : normalizeFolder(input.name);
  if (!name || name.includes("/")) {
    return invalid("フォルダ名が不正です");
  }
  const to = dest.folder ? `${dest.folder}/${name}` : name;
  const dryRun = input.dryRun ?? false;
  if (sameSubject && to === src.folder) {
    const plan = await countSubtree(env, src.owner_id, src.folder);
    return {
      kind: "ok",
      result: { dryRun, from: src.folder, plan, to },
    };
  }
  return commitFolderMove(env, src, dest, to, sameSubject, dryRun, user);
}

async function commitFolderMove(
  env: Env,
  src: { owner_id: string; folder: string },
  dest: DestFolder,
  to: string,
  sameSubject: boolean,
  dryRun: boolean,
  user: SessionUser | undefined,
): Promise<MoveError | MoveOk<MoveFolderResult>> {
  if (await getFolderByPath(env, dest.owner_id, to)) {
    return invalid("同じ名前のフォルダが既にあります", 409);
  }
  const plan = await countSubtree(env, src.owner_id, src.folder);
  if (exceedsLimit(plan)) {
    return limitError();
  }
  if ((await lockedNotesInFolder(env, src.owner_id, src.folder)) > 0) {
    return invalid("編集ロック中のノートを含むため移動できません", 409);
  }
  if (!sameSubject) {
    if (
      dest.owner_kind === "shared_drive" &&
      plan.articleSources > 0 &&
      (await driveRoleFor(env, dest.owner_id, user)) !== "manager"
    ) {
      return invalid("記事ソースを共有ドライブへ移せるのは管理者です", 403);
    }
    return transferAcrossSubjects(env, src, dest, to, dryRun, plan);
  }
  if (!dryRun) {
    await relocateFolderTree(env, src.owner_id, src.folder, to);
  }
  return {
    kind: "ok",
    result: { dryRun, from: src.folder, plan, to },
  };
}

async function transferAcrossSubjects(
  env: Env,
  src: { owner_id: string; folder: string },
  dest: DestFolder,
  to: string,
  dryRun: boolean,
  plan: MovePlan,
): Promise<MoveError | MoveOk<MoveFolderResult>> {
  const blocked = await blockedRootReason(env, src.owner_id, src.folder);
  if (blocked) {
    return invalid(blocked, 409);
  }
  plan.stripped = await strippedCounts(env, src.owner_id, src.folder);
  const audienceTranslations = await listAudienceTranslations(
    env,
    src.owner_id,
    src.folder,
    dest.owner_kind,
  );
  if (!dryRun) {
    await transferFolderTree(env, src.owner_id, src.folder, dest, to);
  }
  return {
    kind: "ok",
    result: {
      audienceTranslations,
      dryRun,
      from: src.folder,
      plan,
      to,
    },
  };
}

export type MoveFolderContentsInput = {
  destFolderId?: string | null;
  /** Also move direct child folders (with their subtrees). */
  includeSubfolders?: boolean;
  dryRun?: boolean;
};

async function moveOneNote(
  env: Env,
  row: NoteRow,
  dest: DestFolder,
  destPath: string,
  dryRun: boolean,
): Promise<MoveNoteItem> {
  // §2.6: folder move is a mutation — locked notes refuse to move.
  if (row.edit_locked === 1) {
    return {
      from: row.folder,
      noteId: row.id,
      reason: "locked",
      status: "failed",
    };
  }
  if (dest.owner_id === row.owner_id && row.folder === destPath) {
    return {
      from: row.folder,
      noteId: row.id,
      reason: "same_folder",
      status: "skipped",
    };
  }
  if (!dryRun) {
    const d1 = db(env);
    const sameSubject = dest.owner_id === row.owner_id;
    await d1.batch([
      ...ensureFolderStatements(env, dest.owner_id, destPath),
      sameSubject
        ? d1
            .prepare("UPDATE notes SET folder = ?, updated_at = ? WHERE id = ?")
            .bind(destPath, Date.now(), row.id)
        : d1
            .prepare(
              `UPDATE notes
                  SET owner_id = ?, owner_kind = ?, folder = ?,
                      read_scope = 'self', write_scope = 'self',
                      permission = 'private', updated_at = ?
                WHERE id = ?`,
            )
            .bind(dest.owner_id, dest.owner_kind, destPath, Date.now(), row.id),
    ]);
    if (!sameSubject) {
      await d1
        .prepare(
          "DELETE FROM access_grants WHERE target_kind = 'note' AND target_key = ?",
        )
        .bind(row.id)
        .run();
      await markDriveFolderKinds(env, dest.owner_id);
    }
  }
  return { from: row.folder, noteId: row.id, status: "moved", to: destPath };
}

function summarizeMove(items: { status: string }[]) {
  let moved = 0;
  let skipped = 0;
  let failed = 0;
  for (const item of items) {
    if (item.status === "moved") {
      moved += 1;
    } else if (item.status === "skipped") {
      skipped += 1;
    } else {
      failed += 1;
    }
  }
  return { failed, moved, skipped };
}

export async function moveFolderContents(
  env: Env,
  folderId: string,
  input: MoveFolderContentsInput,
  user: SessionUser | undefined,
): Promise<MoveError | MoveOk<MoveFolderContentsResult>> {
  const src = await getFolderById(env, folderId);
  if (!src) {
    return { kind: "not_found" };
  }
  const denied = await sourceDenied(env, src.owner_id, user);
  if (denied) {
    return denied;
  }
  const dest = await resolveDest(env, input.destFolderId, user);
  if ("kind" in dest) {
    return dest;
  }
  const dryRun = input.dryRun ?? false;
  const destPath = dest.folder;

  const noteRows = await db(env)
    .prepare(
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE owner_id = ? AND folder = ?`,
    )
    .bind(src.owner_id, src.folder)
    .all<NoteRow>();
  const folderRows = input.includeSubfolders
    ? (
        await db(env)
          .prepare(
            `SELECT id, owner_id, folder, created_at FROM folders
              WHERE owner_id = ? AND ${folderDirectChildrenFilter(src.folder).sql}`,
          )
          .bind(src.owner_id, ...folderDirectChildrenFilter(src.folder).binds)
          .all<{ id: string; owner_id: string; folder: string }>()
      ).results
    : [];

  // Enforce the per-request cap before writing anything.
  let touched = (noteRows.results ?? []).length;
  const childPlans = new Map<string, MovePlan>();
  for (const child of folderRows) {
    const plan = await countSubtree(env, src.owner_id, child.folder);
    childPlans.set(child.id, plan);
    touched += plan.notes + plan.folders;
  }
  if (touched > MOVE_MAX_ITEMS) {
    return limitError();
  }

  const notes: MoveNoteItem[] = [];
  for (const row of noteRows.results ?? []) {
    notes.push(await moveOneNote(env, row, dest, destPath, dryRun));
  }
  const folders = await moveListedChildren(
    env,
    src.owner_id,
    folderRows,
    childPlans,
    dest,
    destPath,
    dryRun,
    user,
  );
  const summary = summarizeMove([...notes, ...folders]);
  const destFolderId = await currentDestId(env, dest, dryRun, summary.moved);
  return {
    kind: "ok",
    result: {
      destFolderId,
      destPath,
      dryRun,
      folders,
      notes,
      ...summary,
    },
  };
}

async function currentDestId(
  env: Env,
  dest: DestFolder,
  dryRun: boolean,
  moved: number,
): Promise<string | null> {
  if (dryRun || moved === 0 || dest.id === null) {
    return dest.id;
  }
  // A delete may have won before the first move batch recreated the path.
  // Return the current UUID so clients can still navigate to the destination.
  return (await getFolderByPath(env, dest.owner_id, dest.folder))?.id ?? null;
}

async function moveListedChildren(
  env: Env,
  ownerId: string,
  children: { id: string; folder: string }[],
  plans: Map<string, MovePlan>,
  dest: DestFolder,
  destPath: string,
  dryRun: boolean,
  user: SessionUser | undefined,
): Promise<MoveFolderItem[]> {
  const crossesIntoDrive =
    dest.owner_kind === "shared_drive" && dest.owner_id !== ownerId;
  const driveManager =
    !crossesIntoDrive ||
    (await driveRoleFor(env, dest.owner_id, user)) === "manager";
  const folders: MoveFolderItem[] = [];
  for (const child of children) {
    if (
      crossesIntoDrive &&
      !driveManager &&
      (plans.get(child.id)?.articleSources ?? 0) > 0
    ) {
      folders.push({
        folderId: child.id,
        from: child.folder,
        reason: "denied",
        status: "failed",
      });
      continue;
    }
    folders.push(
      await moveChildFolder(env, ownerId, child, dest, destPath, dryRun),
    );
  }
  return folders;
}

async function moveChildFolder(
  env: Env,
  ownerId: string,
  child: { id: string; folder: string },
  dest: DestFolder,
  destPath: string,
  dryRun: boolean,
): Promise<MoveFolderItem> {
  const to = destPath
    ? `${destPath}/${folderName(child.folder)}`
    : folderName(child.folder);
  const sameSubject = dest.owner_id === ownerId;
  if (sameSubject && to === child.folder) {
    return {
      folderId: child.id,
      from: child.folder,
      reason: "same_folder",
      status: "skipped",
    };
  }
  if (sameSubject && folderContains(child.folder, destPath)) {
    return {
      folderId: child.id,
      from: child.folder,
      reason: "cycle",
      status: "skipped",
    };
  }
  if (await getFolderByPath(env, dest.owner_id, to)) {
    return {
      folderId: child.id,
      from: child.folder,
      reason: "conflict",
      status: "skipped",
    };
  }
  // §2.6: locked notes inside the subtree block the move.
  if ((await lockedNotesInFolder(env, ownerId, child.folder)) > 0) {
    return {
      folderId: child.id,
      from: child.folder,
      reason: "locked",
      status: "skipped",
    };
  }
  if (dest.owner_id !== ownerId) {
    const blocked = await blockedRootReason(env, ownerId, child.folder);
    if (blocked) {
      return {
        folderId: child.id,
        from: child.folder,
        reason: "conflict",
        status: "failed",
      };
    }
    if (!dryRun) {
      await transferFolderTree(env, ownerId, child.folder, dest, to);
    }
    return { folderId: child.id, from: child.folder, status: "moved", to };
  }
  if (!dryRun) {
    await relocateFolderTree(env, ownerId, child.folder, to);
  }
  return { folderId: child.id, from: child.folder, status: "moved", to };
}

export type MoveNotesInput = {
  noteIds: string[];
  destFolderId?: string | null;
  dryRun?: boolean;
};

async function classifyNoteForMove(
  env: Env,
  noteId: string,
  destOwner: string,
  user: SessionUser,
): Promise<{ row: NoteRow } | { item: MoveNoteItem }> {
  const row = await findNoteRow(env, noteId);
  if (!row) {
    return { item: { noteId, reason: "not_found", status: "failed" } };
  }
  const access = await resolveNoteAccess(env, accessFields(row), user);
  if (!access.flags.canView) {
    // 権限外ノートの存在を漏らさないため not_found と同じ扱いにする。
    return { item: { noteId, reason: "not_found", status: "failed" } };
  }
  if (!(await canEditSubject(env, row.owner_id, user))) {
    return { item: { noteId, reason: "denied", status: "failed" } };
  }
  if (
    row.owner_id !== destOwner &&
    !(await canEditSubject(env, destOwner, user))
  ) {
    return {
      item: {
        from: row.folder,
        noteId,
        reason: "owner_mismatch",
        status: "failed",
      },
    };
  }
  // §2.6: edit-locked notes refuse folder moves.
  if (row.edit_locked === 1) {
    return {
      item: { from: row.folder, noteId, reason: "locked", status: "failed" },
    };
  }
  return { row };
}

export async function moveNotes(
  env: Env,
  input: MoveNotesInput,
  user: SessionUser | undefined,
): Promise<MoveError | MoveOk<MoveNotesResult>> {
  if (!user) {
    return { kind: "denied", status: 401 };
  }
  const noteIds = [...new Set(input.noteIds)];
  if (noteIds.length === 0) {
    return invalid("note_ids が空です");
  }
  if (noteIds.length > MOVE_MAX_ITEMS) {
    return limitError();
  }
  const dest = await resolveDest(env, input.destFolderId, user);
  if ("kind" in dest) {
    return dest;
  }
  const dryRun = input.dryRun ?? false;
  const destPath = dest.folder;

  const items: MoveNoteItem[] = [];
  for (const noteId of noteIds) {
    const classified = await classifyNoteForMove(
      env,
      noteId,
      dest.owner_id,
      user,
    );
    if ("item" in classified) {
      items.push(classified.item);
      continue;
    }
    items.push(await moveOneNote(env, classified.row, dest, destPath, dryRun));
  }
  const summary = summarizeMove(items);
  const destFolderId = await currentDestId(env, dest, dryRun, summary.moved);
  return {
    kind: "ok",
    result: {
      destFolderId,
      destPath,
      dryRun,
      items,
      ...summary,
    },
  };
}

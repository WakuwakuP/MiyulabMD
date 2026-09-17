import {
  folderContains,
  isParaBucketKey,
  type MoveFolderResult,
  PARA_BUCKETS,
  type ParaBucket,
  type ParaBucketKey,
  type ParaListResult,
  type SessionUser,
} from "@miyulabmd/shared";

import { db } from "../db/client.ts";
import {
  ensureFolderRow,
  folderName,
  getFolderById,
  getFolderByPath,
  listFolderChildren,
} from "./access.ts";
import { escapeLikePattern } from "./articles.ts";
import { type MoveError, moveFolder } from "./move.ts";

type BucketRow = { id: string; folder: string };

async function bucketRow(
  env: Env,
  ownerId: string,
  key: ParaBucketKey,
): Promise<BucketRow | null> {
  return (
    (await db(env)
      .prepare(
        "SELECT id, folder FROM folders WHERE owner_id = ? AND para_bucket = ?",
      )
      .bind(ownerId, key)
      .first<BucketRow>()) ?? null
  );
}

async function assignBucket(
  env: Env,
  key: ParaBucketKey,
  folderId: string,
): Promise<void> {
  await db(env)
    .prepare("UPDATE folders SET para_bucket = ? WHERE id = ?")
    .bind(key, folderId)
    .run();
}

/**
 * Materialize the four reserved PARA buckets for an owner. An existing
 * top-level folder with the default name is adopted; otherwise the folder is
 * created. The `para_bucket` key follows the row through renames and moves.
 */
export async function ensureParaBuckets(
  env: Env,
  ownerId: string,
): Promise<{ bucket: ParaBucketKey; id: string; path: string }[]> {
  const out: { bucket: ParaBucketKey; id: string; path: string }[] = [];
  for (const def of PARA_BUCKETS) {
    let row = await bucketRow(env, ownerId, def.key);
    if (!row) {
      const existing = await getFolderByPath(env, ownerId, def.name);
      if (existing) {
        await assignBucket(env, def.key, existing.id);
        row = { folder: existing.folder, id: existing.id };
      }
    }
    if (!row) {
      const id = await ensureFolderRow(env, ownerId, def.name);
      if (!id) {
        continue;
      }
      await assignBucket(env, def.key, id);
      row = { folder: def.name, id };
    }
    out.push({ bucket: def.key, id: row.id, path: row.folder });
  }
  return out;
}

async function countNotesInSubtree(
  env: Env,
  ownerId: string,
  path: string,
): Promise<number> {
  const row = await db(env)
    .prepare(
      `SELECT COUNT(*) AS c FROM notes
       WHERE owner_id = ? AND (folder = ? OR folder LIKE ? ESCAPE '\\')`,
    )
    .bind(ownerId, path, `${escapeLikePattern(path)}/%`)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export type ParaListOutcome =
  | { kind: "ok"; result: ParaListResult }
  | { kind: "denied"; status: 401 }
  | { kind: "invalid"; error: string; status: number };

/**
 * List the caller's PARA buckets. With `bucket`, also returns the direct
 * children of that bucket (active projects, current areas, and so on).
 */
export async function paraList(
  env: Env,
  user: SessionUser | undefined,
  bucket?: string,
): Promise<ParaListOutcome> {
  if (!user) {
    return { kind: "denied", status: 401 };
  }
  if (bucket !== undefined && !isParaBucketKey(bucket)) {
    return {
      error: "bucket は projects/areas/resources/archives のいずれかです",
      kind: "invalid",
      status: 400,
    };
  }
  const rows = await ensureParaBuckets(env, user.id);
  const buckets: ParaBucket[] = [];
  for (const row of rows) {
    buckets.push({
      folderId: row.id,
      key: row.bucket,
      name: folderName(row.path),
      noteCount: await countNotesInSubtree(env, user.id, row.path),
      path: row.path,
    });
  }
  const result: ParaListResult = { buckets };
  if (bucket) {
    const target = rows.find((row) => row.bucket === bucket);
    if (target) {
      result.children = await listFolderChildren(
        env,
        user.id,
        target.path,
        target.id,
        user,
      );
    }
  }
  return { kind: "ok", result };
}

export type ParaArchiveInput = {
  /** Prefix the archived folder name with the current `YYYY-MM-`. */
  dated?: boolean;
  /** Override the archived folder name. */
  name?: string;
  dryRun?: boolean;
};

export async function paraArchiveProject(
  env: Env,
  folderId: string,
  input: ParaArchiveInput,
  user: SessionUser | undefined,
): Promise<MoveError | { kind: "ok"; result: MoveFolderResult }> {
  const rec = await getFolderById(env, folderId);
  if (!rec) {
    return { kind: "not_found" };
  }
  if (!user || user.id !== rec.owner_id) {
    return { kind: "denied", status: user === undefined ? 401 : 403 };
  }
  if (!rec.folder) {
    return {
      error: "マイドライブはアーカイブできません",
      kind: "invalid",
      status: 400,
    };
  }
  const buckets = await ensureParaBuckets(env, rec.owner_id);
  const projects = buckets.find((row) => row.bucket === "projects");
  const archives = buckets.find((row) => row.bucket === "archives");
  if (!(projects && archives)) {
    return {
      error: "PARA バケツを用意できません",
      kind: "invalid",
      status: 500,
    };
  }
  if (
    rec.folder === projects.path ||
    !folderContains(projects.path, rec.folder)
  ) {
    return {
      error: "Projects 配下のフォルダのみアーカイブできます",
      kind: "invalid",
      status: 400,
    };
  }
  let name = input.name?.trim() || folderName(rec.folder);
  if (name.includes("/")) {
    return { error: "フォルダ名が不正です", kind: "invalid", status: 400 };
  }
  if (input.dated) {
    const stamp = new Date().toISOString().slice(0, 7);
    name = `${stamp}-${name}`;
  }
  if (archives.path && folderContains(archives.path, rec.folder)) {
    return {
      error: "このフォルダは既に Archives 配下です",
      kind: "invalid",
      status: 400,
    };
  }
  return moveFolder(
    env,
    folderId,
    {
      destFolderId: archives.id,
      dryRun: input.dryRun,
      name,
    },
    user,
  );
}

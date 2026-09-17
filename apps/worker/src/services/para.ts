import {
  folderContains,
  isParaBucketKey,
  type MoveFolderResult,
  normalizeFolder,
  PARA_BUCKETS,
  type ParaBucket,
  type ParaBucketKey,
  type ParaEnableInput,
  type ParaEnableResult,
  type ParaListResult,
  type ParaPlan,
  type ParaPlanBucket,
  type SessionUser,
} from "@miyulabmd/shared";

import { db } from "../db/client.ts";
import {
  ensureFolderRow,
  folderName,
  getFolderById,
  listFolderChildren,
} from "./access.ts";
import { escapeLikePattern } from "./articles.ts";
import { type MoveError, moveFolder } from "./move.ts";
import { createNoteService } from "./notes.ts";

type BucketRow = { id: string; folder: string };

type FolderBucketRow = {
  id: string;
  owner_id: string;
  folder: string;
  para_bucket: string | null;
};

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

async function folderWithBucketById(
  env: Env,
  id: string,
): Promise<FolderBucketRow | null> {
  return (
    (await db(env)
      .prepare(
        "SELECT id, owner_id, folder, para_bucket FROM folders WHERE id = ?",
      )
      .bind(id)
      .first<FolderBucketRow>()) ?? null
  );
}

async function folderWithBucketAtPath(
  env: Env,
  ownerId: string,
  path: string,
): Promise<FolderBucketRow | null> {
  return (
    (await db(env)
      .prepare(
        "SELECT id, owner_id, folder, para_bucket FROM folders WHERE owner_id = ? AND folder = ?",
      )
      .bind(ownerId, path)
      .first<FolderBucketRow>()) ?? null
  );
}

/**
 * Read-only bucket listing in canonical PARA order. Unlike ensureParaBuckets
 * this never creates folders nor adopts same-named ones.
 */
async function assignedBucketRows(
  env: Env,
  ownerId: string,
): Promise<{ bucket: ParaBucketKey; id: string; path: string }[]> {
  const rows = await db(env)
    .prepare(
      "SELECT id, folder, para_bucket FROM folders WHERE owner_id = ? AND para_bucket IS NOT NULL",
    )
    .bind(ownerId)
    .all<{ id: string; folder: string; para_bucket: string }>();
  const byKey = new Map(
    (rows.results ?? []).map((row) => [row.para_bucket, row]),
  );
  const out: { bucket: ParaBucketKey; id: string; path: string }[] = [];
  for (const def of PARA_BUCKETS) {
    const row = byKey.get(def.key);
    if (row) {
      out.push({ bucket: def.key, id: row.id, path: row.folder });
    }
  }
  return out;
}

/**
 * Materialize the four reserved PARA buckets for an owner. An existing
 * top-level folder with the default name is adopted; otherwise the folder is
 * created. The `para_bucket` key follows the row through renames and moves.
 *
 * Legacy helper kept for explicit setup paths (tests, tooling). The HTTP/MCP
 * read paths must NOT call this — opt-in setup goes through enablePara (§2.4).
 */
export async function ensureParaBuckets(
  env: Env,
  ownerId: string,
): Promise<{ bucket: ParaBucketKey; id: string; path: string }[]> {
  const out: { bucket: ParaBucketKey; id: string; path: string }[] = [];
  for (const def of PARA_BUCKETS) {
    let row = await bucketRow(env, ownerId, def.key);
    if (!row) {
      const existing = await folderWithBucketAtPath(env, ownerId, def.name);
      if (existing && existing.para_bucket === null) {
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

// --- §2.4 plan / enable -----------------------------------------------------

/**
 * Side-effect-free setup inspection for the default (rootless) space.
 * The `space` selector of §2.5 is accepted but not implemented yet — every
 * plan describes the default space, whose root always exists.
 */
async function paraPlanFor(env: Env, ownerId: string): Promise<ParaPlan> {
  const buckets: ParaPlanBucket[] = [];
  for (const def of PARA_BUCKETS) {
    const assigned = await bucketRow(env, ownerId, def.key);
    if (assigned) {
      buckets.push({
        bucket: def.key,
        existing: { id: assigned.id, name: folderName(assigned.folder) },
        status: "assigned",
      });
      continue;
    }
    const occupying = await folderWithBucketAtPath(env, ownerId, def.name);
    if (occupying) {
      buckets.push({
        bucket: def.key,
        existing: { id: occupying.id, name: folderName(occupying.folder) },
        status: "collision",
      });
    } else {
      buckets.push({ bucket: def.key, status: "vacant" });
    }
  }
  return { buckets, space: { status: "exists" } };
}

export type ParaPlanOutcome =
  | { kind: "ok"; plan: ParaPlan }
  | { kind: "denied"; status: 401 };

export async function paraPlan(
  env: Env,
  user: SessionUser | undefined,
): Promise<ParaPlanOutcome> {
  if (!user) {
    return { kind: "denied", status: 401 };
  }
  return { kind: "ok", plan: await paraPlanFor(env, user.id) };
}

type NormalizedResolution =
  | { action: "create" }
  | { action: "skip" }
  | { action: "adopt"; target: FolderBucketRow }
  | { action: "rename"; newName: string; target: FolderBucketRow };

type TargetedResolution = Extract<
  NormalizedResolution,
  { target: FolderBucketRow }
>;

function isTopLevel(row: FolderBucketRow): boolean {
  return row.folder !== "" && !row.folder.includes("/");
}

function invalidResolution(error: string, status = 400): MoveError {
  return { error, kind: "invalid", status };
}

/** Validate an adopt/rename target: exists, owned, top-level, unassigned. */
async function normalizeTargetedResolution(
  env: Env,
  resolution: {
    action: "adopt" | "rename";
    folderId?: string;
    newName?: string;
  },
  user: SessionUser,
): Promise<TargetedResolution | MoveError> {
  if (
    typeof resolution.folderId !== "string" ||
    resolution.folderId.length === 0
  ) {
    return invalidResolution("folderId が必要です");
  }
  const target = await folderWithBucketById(env, resolution.folderId);
  if (!target) {
    return { kind: "not_found" };
  }
  if (target.owner_id !== user.id) {
    return { kind: "denied", status: 403 };
  }
  if (!isTopLevel(target)) {
    return invalidResolution("バケツにはトップレベルフォルダのみ指定できます");
  }
  if (target.para_bucket !== null) {
    return invalidResolution(
      "このフォルダは既に PARA バケツに割り当て済みです",
      409,
    );
  }
  if (resolution.action === "adopt") {
    return { action: "adopt", target };
  }
  const newName = normalizeFolder(resolution.newName);
  if (!newName || newName.includes("/")) {
    return invalidResolution("フォルダ名が不正です");
  }
  return { action: "rename", newName, target };
}

async function normalizeOneResolution(
  env: Env,
  key: string,
  resolution: unknown,
  user: SessionUser,
  seenTargets: Set<string>,
): Promise<{ key: ParaBucketKey; value: NormalizedResolution } | MoveError> {
  if (!isParaBucketKey(key)) {
    return invalidResolution(`不明なバケツです: ${key}`);
  }
  if (typeof resolution !== "object" || resolution === null) {
    return invalidResolution("resolution が不正です");
  }
  const action = (resolution as { action?: string }).action;
  if (action === "create" || action === "skip") {
    return { key, value: { action } };
  }
  if (action !== "adopt" && action !== "rename") {
    return invalidResolution(
      "action は create / adopt / rename / skip のいずれかです",
    );
  }
  const normalized = await normalizeTargetedResolution(
    env,
    resolution as { action: "adopt" | "rename"; folderId?: string },
    user,
  );
  if ("kind" in normalized) {
    return normalized;
  }
  if (seenTargets.has(normalized.target.id)) {
    return invalidResolution("同じフォルダを複数のバケツに割り当てられません");
  }
  seenTargets.add(normalized.target.id);
  return { key, value: normalized };
}

/**
 * Validate every requested resolution before touching the database so a bad
 * entry cannot leave the setup half-applied.
 */
async function normalizeResolutions(
  env: Env,
  input: ParaEnableInput | null | undefined,
  user: SessionUser,
): Promise<Map<ParaBucketKey, NormalizedResolution> | MoveError> {
  const out = new Map<ParaBucketKey, NormalizedResolution>();
  const seenTargets = new Set<string>();
  for (const [key, resolution] of Object.entries(input?.resolutions ?? {})) {
    const normalized = await normalizeOneResolution(
      env,
      key,
      resolution,
      user,
      seenTargets,
    );
    if ("kind" in normalized) {
      return normalized;
    }
    out.set(normalized.key, normalized.value);
  }
  return out;
}

/**
 * Create the bucket's default folder and tag it. Returns false when the name
 * is (still) occupied — the caller reports it as a remaining collision rather
 * than silently adopting the folder.
 */
async function createBucketFolder(
  env: Env,
  ownerId: string,
  def: (typeof PARA_BUCKETS)[number],
): Promise<boolean> {
  const occupying = await folderWithBucketAtPath(env, ownerId, def.name);
  if (occupying) {
    return false;
  }
  const id = await ensureFolderRow(env, ownerId, def.name);
  if (!id) {
    return false;
  }
  const row = await folderWithBucketById(env, id);
  if (!row || row.para_bucket !== null) {
    return false;
  }
  await assignBucket(env, def.key, id);
  return true;
}

export type ParaEnableOutcome =
  | { kind: "ok"; result: ParaEnableResult }
  | { kind: "not_found" }
  | { kind: "denied"; status: 401 | 403 }
  | { kind: "invalid"; error: string; status: number };

/**
 * §2.4 enable: apply resolutions for the default space. Idempotent — already
 * assigned buckets are no-ops and skip is not persisted. Buckets left in
 * collision (no resolution given, or create/adopt raced) come back in
 * `pending` so the caller can collect resolutions and re-run.
 */
/**
 * Apply one bucket's resolution (or the implicit create for a vacant name).
 * "skipped" = the caller asked to leave it unassigned; a MoveError aborts the
 * whole enable so the caller can surface it.
 */
async function applyBucketSetup(
  env: Env,
  notes: ReturnType<typeof createNoteService>,
  user: SessionUser,
  def: (typeof PARA_BUCKETS)[number],
  resolution: NormalizedResolution | undefined,
): Promise<"ok" | "skipped" | MoveError> {
  if (resolution?.action === "skip") {
    return "skipped";
  }
  if (resolution?.action === "adopt") {
    // Re-check: the folder may have been assigned since validation.
    const fresh = await folderWithBucketById(env, resolution.target.id);
    if (fresh && fresh.para_bucket === null) {
      await assignBucket(env, def.key, fresh.id);
    }
    return "ok";
  }
  if (resolution?.action === "rename") {
    const renamed = await notes.renameFolder(
      resolution.target.id,
      resolution.newName,
      user,
    );
    if (renamed.kind !== "ok") {
      return renamed;
    }
    // The default name is now free — fall through to create the bucket.
  }
  // create (explicit, post-rename, or the default action for a vacant name)
  await createBucketFolder(env, user.id, def);
  return "ok";
}

export async function enablePara(
  env: Env,
  input: ParaEnableInput | null | undefined,
  user: SessionUser | undefined,
): Promise<ParaEnableOutcome> {
  if (!user) {
    return { kind: "denied", status: 401 };
  }
  const resolutions = await normalizeResolutions(env, input, user);
  if ("kind" in resolutions) {
    return resolutions;
  }

  const notes = createNoteService(env);
  const skipped = new Set<ParaBucketKey>();
  for (const def of PARA_BUCKETS) {
    if (await bucketRow(env, user.id, def.key)) {
      continue; // already assigned: no-op
    }
    const applied = await applyBucketSetup(
      env,
      notes,
      user,
      def,
      resolutions.get(def.key),
    );
    if (applied === "skipped") {
      skipped.add(def.key);
      continue;
    }
    if (applied !== "ok") {
      return applied;
    }
  }

  return finishEnable(env, user.id, skipped);
}

async function finishEnable(
  env: Env,
  ownerId: string,
  skipped: Set<ParaBucketKey>,
): Promise<ParaEnableOutcome> {
  const plan = await paraPlanFor(env, ownerId);
  const pending = plan.buckets
    .filter((bucket) => bucket.status !== "assigned")
    .filter((bucket) => !skipped.has(bucket.bucket))
    .map((bucket) => bucket.bucket);
  return { kind: "ok", result: { pending, plan } };
}

// --- read paths -------------------------------------------------------------

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
 * Read-only per §2.4: an unset-up drive returns an empty bucket list.
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
  const rows = await assignedBucketRows(env, user.id);
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
  const buckets = await assignedBucketRows(env, rec.owner_id);
  const projects = buckets.find((row) => row.bucket === "projects");
  const archives = buckets.find((row) => row.bucket === "archives");
  if (!(projects && archives)) {
    return {
      error: "PARA バケツが未セットアップです",
      kind: "invalid",
      status: 400,
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

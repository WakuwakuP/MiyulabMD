import {
  PARA_BUCKETS,
  type ParaBucketKey,
  type ParaBucketResolution,
  type ParaPlan,
  type ParaPlanBucket,
} from "@miyulabmd/shared";

/**
 * §2.4 競合モーダルの純粋な状態遷移。衝突バケツごとに
 * rename（既存を改名してバケツ新設）/ adopt（既存をバケツ化）/ skip を選ぶ。
 * キャンセルは副作用なし（呼び出し側が閉じるだけ）。
 */

export type ParaResolutionChoice = "rename" | "adopt" | "skip";

export type ParaConflictItem = {
  bucket: ParaBucketKey;
  /** Default folder name the bucket wants (e.g. "Projects"). */
  defaultName: string;
  /** The unassigned top-level folder currently occupying the default name. */
  existingId: string;
  existingName: string;
  choice: ParaResolutionChoice;
  /** New name for the existing folder when choice === "rename". */
  newName: string;
};

/** Buckets whose default name is taken by an unassigned folder. */
export function paraPlanConflicts(plan: ParaPlan): ParaPlanBucket[] {
  return plan.buckets.filter((bucket) => bucket.status === "collision");
}

/** Initial modal state: one row per collision, rename pre-selected. */
export function initParaConflicts(plan: ParaPlan): ParaConflictItem[] {
  return paraPlanConflicts(plan).map((bucket) => {
    const existingName = bucket.existing?.name ?? "";
    return {
      bucket: bucket.bucket,
      choice: "rename",
      defaultName:
        PARA_BUCKETS.find((def) => def.key === bucket.bucket)?.name ??
        bucket.bucket,
      existingId: bucket.existing?.id ?? "",
      existingName,
      newName: existingName ? `${existingName} (old)` : "",
    };
  });
}

export function setParaConflictChoice(
  items: ParaConflictItem[],
  bucket: ParaBucketKey,
  choice: ParaResolutionChoice,
): ParaConflictItem[] {
  return items.map((item) =>
    item.bucket === bucket ? { ...item, choice } : item,
  );
}

export function setParaConflictNewName(
  items: ParaConflictItem[],
  bucket: ParaBucketKey,
  newName: string,
): ParaConflictItem[] {
  return items.map((item) =>
    item.bucket === bucket ? { ...item, newName } : item,
  );
}

/** Every row has a usable resolution (rename requires a non-empty new name). */
export function paraConflictsReady(items: ParaConflictItem[]): boolean {
  return items.every(
    (item) => item.choice !== "rename" || item.newName.trim().length > 0,
  );
}

/** Build the `resolutions` map for POST /api/para/enable. */
export function paraConflictResolutions(
  items: ParaConflictItem[],
): Partial<Record<ParaBucketKey, ParaBucketResolution>> {
  const out: Partial<Record<ParaBucketKey, ParaBucketResolution>> = {};
  for (const item of items) {
    switch (item.choice) {
      case "rename":
        out[item.bucket] = {
          action: "rename",
          folderId: item.existingId,
          newName: item.newName.trim(),
        };
        break;
      case "adopt":
        out[item.bucket] = { action: "adopt", folderId: item.existingId };
        break;
      case "skip":
        out[item.bucket] = { action: "skip" };
        break;
    }
  }
  return out;
}

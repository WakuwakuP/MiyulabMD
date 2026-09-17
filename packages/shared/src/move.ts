import type { FolderChildrenResult } from "./note.ts";

/**
 * Reserved PARA buckets. `key` is a stable identifier stored on the folders row
 * (`para_bucket`) so bucket membership survives renames and moves; `name` is the
 * default top-level folder name used when materializing a missing bucket.
 */
export const PARA_BUCKETS = [
  { key: "projects", name: "Projects" },
  { key: "areas", name: "Areas" },
  { key: "resources", name: "Resources" },
  { key: "archives", name: "Archives" },
] as const;

export type ParaBucketKey = (typeof PARA_BUCKETS)[number]["key"];

export function isParaBucketKey(value: string): value is ParaBucketKey {
  return PARA_BUCKETS.some((bucket) => bucket.key === value);
}

export type ParaBucket = {
  key: ParaBucketKey;
  folderId: string;
  /** Current folder name — may differ from the default after renames. */
  name: string;
  path: string;
  /** Recursive count of notes inside the bucket. */
  noteCount: number;
};

export type ParaListResult = {
  buckets: ParaBucket[];
  /** Present when a single bucket is requested. */
  children?: FolderChildrenResult;
};

// --- §2.4 enable flow: plan (side-effect-free) + enable (resolutions) -------

export type ParaPlanStatus = "assigned" | "vacant" | "collision";

export type ParaPlanExisting = {
  id: string;
  name: string;
};

export type ParaPlanBucket = {
  bucket: ParaBucketKey;
  /**
   * assigned = para_bucket already set on a folder / vacant = default name is
   * free to create / collision = a top-level folder holds the default name but
   * is not bucket-assigned.
   */
  status: ParaPlanStatus;
  /** For collision: the folder occupying the default name. For assigned: the
   * folder fulfilling the bucket (name may differ after renames). */
  existing?: ParaPlanExisting;
};

export type ParaSpacePlan = {
  status: "exists" | "vacant" | "collision";
  existing?: ParaPlanExisting;
};

/**
 * Side-effect-free setup inspection. `space` is the §2.5 multi-space wrapper;
 * for now only the default (rootless) space exists, always "exists".
 */
export type ParaPlan = {
  space: ParaSpacePlan;
  buckets: ParaPlanBucket[];
};

export type ParaBucketResolution =
  | { action: "create" }
  | { action: "adopt"; folderId: string }
  | { action: "rename"; folderId: string; newName: string }
  | { action: "skip" };

/** Reserved for §2.5: selects a named space root. Omit for the default space. */
export type ParaSpaceRef = { id: string } | { name: string };

export type ParaEnableInput = {
  space?: ParaSpaceRef | "default" | null;
  resolutions?: Partial<Record<ParaBucketKey, ParaBucketResolution>>;
};

export type ParaEnableResult = {
  /** Post-enable plan; skipped buckets keep their pre-enable status. */
  plan: ParaPlan;
  /**
   * Buckets still unassigned because a name collision was not resolved.
   * Non-empty means the caller should collect resolutions and re-run enable.
   */
  pending: ParaBucketKey[];
};

/** Max entities (notes + folders) one move request may touch. */
export const MOVE_MAX_ITEMS = 500;

/** Counts of entities a folder relocation will rewrite. */
export type MovePlan = {
  notes: number;
  folders: number;
  policies: number;
  grants: number;
  articleSources: number;
};

export type MoveItemStatus = "moved" | "skipped" | "failed";

export type MoveItemReason =
  | "not_found"
  | "denied"
  | "owner_mismatch"
  | "same_folder"
  | "conflict"
  | "cycle";

export type MoveNoteItem = {
  noteId: string;
  status: MoveItemStatus;
  reason?: MoveItemReason;
  from?: string;
  to?: string;
};

export type MoveFolderItem = {
  folderId: string;
  status: MoveItemStatus;
  reason?: MoveItemReason;
  from?: string;
  to?: string;
};

export type MoveFolderResult = {
  from: string;
  to: string;
  plan: MovePlan;
  dryRun: boolean;
};

export type MoveNotesResult = {
  destFolderId: string | null;
  destPath: string;
  items: MoveNoteItem[];
  moved: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
};

export type MoveFolderContentsResult = {
  destFolderId: string | null;
  destPath: string;
  notes: MoveNoteItem[];
  folders: MoveFolderItem[];
  moved: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
};

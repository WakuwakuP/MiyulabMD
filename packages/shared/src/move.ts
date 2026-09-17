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

import type { ArticleMeta } from "./article.ts";
import type {
  AccessScope,
  CollaboratorRole,
  EffectiveAccess,
  PermissionFlags,
  PermissionPreset,
} from "./permission.ts";

export type NoteId = string;

export const NOTE_HISTORY_ACTOR_KINDS = ["user", "agent", "guest"] as const;
export type NoteHistoryActorKind = (typeof NOTE_HISTORY_ACTOR_KINDS)[number];

export const NOTE_EDIT_OPS = [
  "insert",
  "delete",
  "replace",
  "restore",
] as const;
export type NoteEditOp = (typeof NOTE_EDIT_OPS)[number];

export type NoteHistoryActor = {
  kind: NoteHistoryActorKind;
  userId: string | null;
  name: string;
};

export type NoteEditEvent = {
  id: string;
  noteId: NoteId;
  revisionId: string | null;
  actor: NoteHistoryActor;
  startedAt: number;
  endedAt: number;
  startOffset: number;
  endOffset: number;
  op: NoteEditOp;
  excerpt: string;
  createdAt: number;
};

export type NoteRevision = {
  id: string;
  noteId: NoteId;
  eventId: string | null;
  r2Key: string;
  byteSize: number;
  actor: NoteHistoryActor;
  createdAt: number;
};

export type NoteHistoryPage = {
  events: NoteEditEvent[];
  nextBefore: number | null;
};

export type NoteRevisionBody = NoteRevision & {
  markdown: string;
};

export type NoteRevisionRestore = {
  restored: true;
  revisionId: string;
  message: string;
};

export const NOTE_RESTORE_MESSAGE =
  "今の本文を、選んだ時点の全文で置き換えました。同時に編集していた内容は上書きされます。";

export function isNoteHistoryActorKind(
  value: string,
): value is NoteHistoryActorKind {
  return (NOTE_HISTORY_ACTOR_KINDS as readonly string[]).includes(value);
}

export function isNoteEditOp(value: string): value is NoteEditOp {
  return (NOTE_EDIT_OPS as readonly string[]).includes(value);
}

export type NoteAccess = EffectiveAccess & {
  flags: PermissionFlags;
};

export type FolderRecord = {
  id: string;
  name: string;
  parentId: string | null;
  folder?: string;
  /** Effective scopes for list display (not a path leak). */
  readScope?: AccessScope;
  writeScope?: AccessScope;
};

export type FolderCrumb = {
  id: string;
  name: string;
};

export type Note = {
  id: NoteId;
  shortId: string;
  alias: string | null;
  ownerId: string;
  title: string;
  folder: string;
  folderId: string | null;
  permission: PermissionPreset;
  access: NoteAccess;
  markdown: string;
  articleMeta: ArticleMeta;
  createdAt: number;
  updatedAt: number;
};

export type NoteSummary = Omit<Note, "markdown">;

export type NoteCollaborator = {
  noteId: NoteId;
  userId: string;
  email: string;
  role: CollaboratorRole;
  createdAt: number;
};

export type AccessGrantInput = {
  email: string;
  canWrite?: boolean;
};

export type CreateNoteInput = {
  title?: string;
  markdown?: string;
  folder?: string;
  folderId?: string;
  permission?: PermissionPreset;
  inheritAccess?: boolean;
  readScope?: AccessScope;
  writeScope?: AccessScope;
};

export type UpdateNoteMetaInput = {
  title?: string;
  alias?: string | null;
  folder?: string;
  permission?: PermissionPreset;
  inheritAccess?: boolean;
  readScope?: AccessScope | null;
  writeScope?: AccessScope | null;
  grants?: AccessGrantInput[];
};

export type FolderAccess = EffectiveAccess & {
  id: string | null;
  name: string;
  parentId: string | null;
  folder?: string;
  crumbs: FolderCrumb[];
  children: FolderRecord[];
  flags: PermissionFlags;
  locked?: boolean;
};

export type UpdateFolderAccessInput = {
  folder?: string;
  folderId?: string;
  inherit?: boolean;
  readScope?: AccessScope;
  writeScope?: AccessScope;
  grants?: AccessGrantInput[];
};

export type { AccessGrant } from "./permission.ts";

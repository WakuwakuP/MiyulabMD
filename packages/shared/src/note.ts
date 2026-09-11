import type { ArticleMeta } from "./article.ts";
import type {
  AccessScope,
  CollaboratorRole,
  EffectiveAccess,
  PermissionFlags,
  PermissionPreset,
} from "./permission.ts";
import { defaultNoteMarkdown, normalizeFolder } from "./title.ts";

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

export const NOTE_CREATE_ERROR_CODES = [
  "owner_mismatch",
  "idempotency_conflict",
  "draft_deleted",
  "mapping_mismatch",
  "content_conflict",
] as const;

export type NoteCreateErrorCode = (typeof NOTE_CREATE_ERROR_CODES)[number];

export type CreateNoteInput = {
  title?: string;
  markdown?: string;
  folder?: string;
  folderId?: string;
  permission?: PermissionPreset;
  inheritAccess?: boolean;
  readScope?: AccessScope;
  writeScope?: AccessScope;
  /** Offline local draft id (`local-{uuid}`). Requires `draftOwnerId`. */
  clientDraftId?: string;
  /** Authenticated user id that owns the draft. Must match session user. */
  draftOwnerId?: string;
};

export type UpdateNoteMarkdownInput = {
  markdown: string;
  expectedMarkdown?: string;
  clientDraftId?: string;
  draftOwnerId?: string;
};

const LOCAL_DRAFT_ID_PATTERN =
  /^local-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isClientDraftId(value: string): boolean {
  return LOCAL_DRAFT_ID_PATTERN.test(value);
}

export type DraftKeyValidation =
  | { ok: true; clientDraftId: string; draftOwnerId: string }
  | { ok: false; error: string };

/** Both draft keys must be present together with valid shapes, or both omitted. */
export function validateDraftKeys(input: {
  clientDraftId?: string;
  draftOwnerId?: string;
}): DraftKeyValidation | { ok: true; clientDraftId?: undefined; draftOwnerId?: undefined } {
  const hasClient = input.clientDraftId !== undefined;
  const hasOwner = input.draftOwnerId !== undefined;
  if (!hasClient && !hasOwner) {
    return { ok: true };
  }
  if (!hasClient || !hasOwner) {
    return { ok: false, error: "clientDraftId and draftOwnerId must both be provided" };
  }
  const clientDraftId = input.clientDraftId!.trim();
  const draftOwnerId = input.draftOwnerId!.trim();
  if (!isClientDraftId(clientDraftId)) {
    return { ok: false, error: "clientDraftId must match local-{uuid}" };
  }
  if (draftOwnerId.length === 0 || draftOwnerId.length > 128) {
    return { ok: false, error: "draftOwnerId is invalid" };
  }
  return { ok: true, clientDraftId, draftOwnerId };
}

export function isConditionalMarkdownUpdate(
  input: UpdateNoteMarkdownInput,
): boolean {
  return (
    input.expectedMarkdown !== undefined ||
    input.clientDraftId !== undefined ||
    input.draftOwnerId !== undefined
  );
}

/** Stable fingerprint of create intent (excludes ids, timestamps, draft keys). */
export function normalizedCreateInputForHash(
  input: CreateNoteInput,
): Record<string, unknown> {
  const title = input.title?.trim();
  const markdown =
    input.markdown ??
    defaultNoteMarkdown(title && title.length > 0 ? title : "無題");
  const payload: Record<string, unknown> = { markdown };
  if (input.folder !== undefined) {
    payload.folder = normalizeFolder(input.folder);
  }
  if (input.folderId !== undefined) {
    payload.folderId = input.folderId;
  }
  if (input.inheritAccess !== undefined) {
    payload.inheritAccess = input.inheritAccess;
  }
  if (input.permission !== undefined) {
    payload.permission = input.permission;
  }
  if (input.readScope !== undefined) {
    payload.readScope = input.readScope;
  }
  if (input.writeScope !== undefined) {
    payload.writeScope = input.writeScope;
  }
  if (title !== undefined && title.length > 0) {
    payload.title = title;
  }
  const stable: Record<string, unknown> = {};
  for (const key of Object.keys(payload).sort()) {
    stable[key] = payload[key];
  }
  return stable;
}

export async function computeCreateRequestHash(
  input: CreateNoteInput,
): Promise<string> {
  const json = JSON.stringify(normalizedCreateInputForHash(input));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(json),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

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

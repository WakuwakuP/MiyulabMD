import type {
  AccessGrant,
  AccessScope,
  CollaboratorRole,
  EffectiveAccess,
  PermissionFlags,
  PermissionPreset,
} from "./permission.ts";

export type NoteId = string;

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

export type { AccessGrant };

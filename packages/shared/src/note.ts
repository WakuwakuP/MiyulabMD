import type { CollaboratorRole, PermissionPreset } from "./permission.ts";

export type NoteId = string;

export type Note = {
  id: NoteId;
  shortId: string;
  alias: string | null;
  ownerId: string;
  title: string;
  permission: PermissionPreset;
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

export type CreateNoteInput = {
  title?: string;
  markdown?: string;
  permission?: PermissionPreset;
};

export type UpdateNoteMetaInput = {
  title?: string;
  alias?: string | null;
  permission?: PermissionPreset;
};

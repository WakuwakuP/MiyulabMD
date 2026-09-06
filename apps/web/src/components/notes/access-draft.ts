import type { FolderAccess, Note, NoteSummary } from "@miyulabmd/shared";
import type { AccessDraft } from "./AccessPanel.tsx";

export function draftFromFolder(access: FolderAccess): AccessDraft {
  return {
    grants: access.grants,
    inherit: access.inherit,
    readScope: access.effectiveReadScope,
    writeScope: access.effectiveWriteScope,
  };
}

export function draftFromNote(note: Note | NoteSummary): AccessDraft {
  return {
    grants: note.access.grants,
    inherit: note.access.inherit,
    readScope: note.access.effectiveReadScope,
    writeScope: note.access.effectiveWriteScope,
  };
}

export function accessGrantInputs(draft: AccessDraft) {
  return draft.grants.map((grant) => ({
    canWrite: grant.canWrite,
    email: grant.email,
  }));
}

export function folderAccessPatch(draft: AccessDraft) {
  return {
    grants: accessGrantInputs(draft),
    inherit: draft.inherit,
    readScope: draft.inherit ? undefined : draft.readScope,
    writeScope: draft.inherit ? undefined : draft.writeScope,
  };
}

export function noteAccessPatch(draft: AccessDraft) {
  return {
    grants: accessGrantInputs(draft),
    inheritAccess: draft.inherit,
    readScope: draft.inherit ? null : draft.readScope,
    writeScope: draft.inherit ? null : draft.writeScope,
  };
}

export function causeMessage(cause: unknown, fallback: string): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return fallback;
}

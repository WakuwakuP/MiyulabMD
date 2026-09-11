import type { NoteSummary, SessionUser } from "@miyulabmd/shared";
import { titleFromMarkdown } from "@miyulabmd/shared";
import type { LocalDraft } from "./draft-store.ts";
import type { SessionSnapshot } from "./offline-session.ts";

export type HomeListItem = NoteSummary & { isLocalDraft?: boolean };

const CREATABLE_STATUSES = new Set<SessionSnapshot["status"]>([
  "online-confirmed",
  "offline-known",
]);

export function canCreateLocalDraft(
  session: SessionSnapshot,
  user: SessionUser | null,
): boolean {
  return Boolean(user && CREATABLE_STATUSES.has(session.status));
}

export function draftToNoteSummary(draft: LocalDraft): HomeListItem {
  return {
    access: {
      effectiveReadScope: "self",
      effectiveWriteScope: "self",
      flags: { canAdmin: true, canEdit: true, canView: true },
      grants: [],
      inherit: true,
      readScope: null,
      source: "default",
      sourceFolder: null,
      writeScope: null,
    },
    alias: null,
    articleMeta: {},
    createdAt: draft.createdAt,
    folder: draft.folder,
    folderId: draft.folderId ?? null,
    id: draft.localId,
    isLocalDraft: true,
    ownerId: draft.ownerId,
    permission: "private",
    shortId: draft.localId,
    title: `${titleFromMarkdown(draft.markdown) || "無題"}（未保存）`,
    updatedAt: draft.updatedAt,
  };
}

export function mergeHomeDisplayNotes(
  serverNotes: NoteSummary[],
  drafts: LocalDraft[],
  currentFolderId: string | null,
): HomeListItem[] {
  const draftItems = drafts
    .filter((draft) => (draft.folderId ?? null) === currentFolderId)
    .map(draftToNoteSummary);
  return [...draftItems, ...serverNotes].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

export function isLocalDraftSummary(note: NoteSummary): note is HomeListItem {
  return note.id.startsWith("local-");
}

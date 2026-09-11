import type { Note, SessionUser } from "@miyulabmd/shared";
import type { MutableRefObject } from "react";
import type { AccessDraft } from "../components/notes/AccessPanel.tsx";
import {
  draftFromNote,
  noteAccessPatch,
} from "../components/notes/access-draft.ts";
import type { ApiResult } from "../lib/api.ts";
import { fetchArticleSources, updateNote } from "../lib/api.ts";
import { applyAwarenessUser } from "../lib/collaboration.ts";
import {
  type CollabSessionSnapshot,
  createNoteCollabSession,
  type NoteCollabSession,
} from "../lib/collaboration-session.ts";
import { type EditorMode, writeEditorMode } from "../lib/editor-mode.ts";
import { loadOgCards } from "../lib/markdown.ts";
import { noteFromCaches, seedNoteCache } from "../lib/note-cache.ts";
import { nextRequestGeneration } from "../lib/offline-types.ts";

export type NoteSetters = {
  setNote: (note: Note | null) => void;
  setMarkdown: (markdown: string) => void;
  setFolder: (folder: string) => void;
  setAccessDraft: (draft: AccessDraft | null) => void;
};

export function applyLoadedNote(loaded: Note, setters: NoteSetters) {
  setters.setNote(loaded);
  setters.setMarkdown(loaded.markdown);
  setters.setFolder(loaded.folder);
  setters.setAccessDraft(draftFromNote(loaded));
}

export function noteLoadErrorMessage(status: number, fallback: string): string {
  if (status === 401) {
    return "このノートを表示するにはログインが必要です。";
  }
  if (status === 403) {
    return "このノートを表示する権限がありません。";
  }
  if (status === 404) {
    return "ノートが見つかりません。";
  }
  return fallback;
}

type EditorLoadSetters = NoteSetters & {
  setLoadError: (error: string | null) => void;
  setSaveError: (error: string | null) => void;
  setCollab: (session: NoteCollabSession | null) => void;
  setCollabReady: (ready: boolean) => void;
  setCollabSnapshot: (snapshot: CollabSessionSnapshot | null) => void;
  setMode: (mode: EditorMode) => void;
  setSplitScroll: (ratio: number) => void;
  setLoading: (loading: boolean) => void;
  hydratedRef: MutableRefObject<boolean>;
};

export function beginEditorNoteLoad(
  id: string,
  setters: EditorLoadSetters,
): Note | undefined {
  const hit = noteFromCaches(id);
  setters.setLoadError(null);
  setters.setSaveError(null);
  setters.setCollab(null);
  setters.setCollabReady(false);
  setters.setCollabSnapshot(null);
  setters.setMode("preview");
  setters.setSplitScroll(0);

  if (hit) {
    applyLoadedNote(hit, setters);
    setters.hydratedRef.current = true;
    setters.setLoading(false);
    void loadOgCards(hit.markdown);
    return hit;
  }
  setters.hydratedRef.current = false;
  setters.setLoading(true);
  return undefined;
}

export function applyEditorNoteLoad(
  result: ApiResult<Note>,
  id: string,
  hit: Note | undefined,
  cancelled: boolean,
  setters: EditorLoadSetters,
) {
  if (cancelled) {
    return;
  }
  if (!result.ok) {
    setters.setLoadError(noteLoadErrorMessage(result.status, result.error));
    if (!noteFromCaches(id)) {
      setters.setNote(null);
    }
    setters.setLoading(false);
    return;
  }

  if (hit) {
    setters.setNote(result.data);
    setters.setFolder(result.data.folder);
    setters.setAccessDraft(draftFromNote(result.data));
  } else {
    applyLoadedNote(result.data, setters);
    setters.hydratedRef.current = true;
  }
  setters.setLoading(false);
  void loadOgCards(result.data.markdown);
}

export function subscribeArticleSources(
  user: SessionUser | null,
  setArticleSources: (
    sources: import("@miyulabmd/shared").ArticleSource[],
  ) => void,
): (() => void) | undefined {
  if (!user) {
    setArticleSources([]);
    return undefined;
  }
  let cancelled = false;
  void fetchArticleSources().then((result) => {
    if (cancelled || !result.ok) {
      return;
    }
    setArticleSources(result.data);
  });
  return () => {
    cancelled = true;
  };
}

export function teardownCollab(
  unbindRef: MutableRefObject<(() => void) | null>,
  sessionRef: MutableRefObject<NoteCollabSession | null>,
  setCollab: (session: NoteCollabSession | null) => void,
  setCollabReady: (ready: boolean) => void,
  setCollabSnapshot: (snapshot: CollabSessionSnapshot | null) => void,
) {
  unbindRef.current?.();
  unbindRef.current = null;
  const session = sessionRef.current;
  sessionRef.current = null;
  if (session) {
    void session.close();
  }
  setCollab(null);
  setCollabReady(false);
  setCollabSnapshot(null);
}

function applyCollabSnapshot(
  snap: CollabSessionSnapshot,
  session: NoteCollabSession,
  setCollabReady: (ready: boolean) => void,
  setCollabSnapshot: (snapshot: CollabSessionSnapshot) => void,
  setMarkdown: (markdown: string) => void,
) {
  setCollabSnapshot(snap);
  setCollabReady(snap.collabReady);
  if (snap.editDenied) {
    return;
  }
  if (snap.collabReady) {
    const next = session.yMarkdown.toString();
    if (next.length > 0) {
      setMarkdown(next);
    }
  }
}

export function bindEditorCollab(input: {
  noteId: string | undefined;
  hydrated: boolean;
  userLoading: boolean;
  needsSession: boolean;
  desiredConnection: boolean;
  user: SessionUser | null;
  sessionRef: MutableRefObject<NoteCollabSession | null>;
  unbindRef: MutableRefObject<(() => void) | null>;
  setCollab: (session: NoteCollabSession | null) => void;
  setCollabReady: (ready: boolean) => void;
  setCollabSnapshot: (snapshot: CollabSessionSnapshot | null) => void;
  setMarkdown: (markdown: string) => void;
}) {
  if (!(input.noteId && input.hydrated) || input.userLoading) {
    return;
  }

  if (input.sessionRef.current) {
    input.sessionRef.current.setNeedsSession(input.needsSession);
    input.sessionRef.current.setDesiredConnection(input.desiredConnection);
    return;
  }

  if (!input.needsSession) {
    return;
  }

  const generation = nextRequestGeneration();
  const session = createNoteCollabSession({
    generation,
    noteId: input.noteId,
    user: input.user,
  });
  input.sessionRef.current = session;
  input.setCollab(session);
  input.setCollabReady(false);

  const onMarkdownChange = () => {
    input.setMarkdown(session.yMarkdown.toString());
  };
  session.yMarkdown.observe(onMarkdownChange);

  const unsub = session.subscribe((snap) => {
    applyCollabSnapshot(
      snap,
      session,
      input.setCollabReady,
      input.setCollabSnapshot,
      input.setMarkdown,
    );
    if (!snap.needsSession || snap.phase === "closed" || snap.denied) {
      input.unbindRef.current?.();
      input.unbindRef.current = null;
      input.sessionRef.current = null;
      input.setCollab(null);
      input.setCollabReady(false);
      input.setCollabSnapshot(null);
    }
  });

  input.unbindRef.current = () => {
    session.yMarkdown.unobserve(onMarkdownChange);
    unsub();
  };
}

export function syncCollabUser(
  collab: NoteCollabSession | null,
  user: SessionUser | null,
) {
  if (!collab) {
    return;
  }
  collab.setUser(user);
  applyAwarenessUser(collab.awareness, user);
}

export async function persistEditorAccess(
  note: Note | null,
  next: AccessDraft,
  setters: {
    setAccessDraft: (draft: AccessDraft) => void;
    setSaveError: (error: string | null) => void;
    setNote: (note: Note) => void;
  },
) {
  if (!note) {
    return;
  }
  setters.setAccessDraft(next);
  setters.setSaveError(null);

  const result = await updateNote(note.id, noteAccessPatch(next));
  if (!result.ok) {
    setters.setSaveError(result.error);
    setters.setAccessDraft(draftFromNote(note));
    return;
  }
  setters.setNote(result.data);
  setters.setAccessDraft(draftFromNote(result.data));
  seedNoteCache(result.data);
}

export async function persistEditorFolder(
  note: Note | null,
  folder: string,
  normalizeFolder: (value: string) => string,
  setters: {
    setFolder: (folder: string) => void;
    setSaveError: (error: string | null) => void;
    setNote: (note: Note) => void;
    setAccessDraft: (draft: AccessDraft) => void;
  },
) {
  if (!note) {
    return;
  }
  const next = normalizeFolder(folder);
  if (next === note.folder) {
    return;
  }

  const result = await updateNote(note.id, { folder: next });
  if (!result.ok) {
    setters.setFolder(note.folder);
    setters.setSaveError(result.error);
    return;
  }
  setters.setNote(result.data);
  setters.setFolder(result.data.folder);
  setters.setAccessDraft(draftFromNote(result.data));
  seedNoteCache(result.data);
}

export function changeEditorMode(
  canEdit: boolean,
  next: EditorMode,
  setMode: (mode: EditorMode) => void,
) {
  if (!canEdit && next !== "preview") {
    return;
  }
  setMode(next);
  writeEditorMode(next);
}

export function applySplitScroll(
  ratio: number,
  lock: MutableRefObject<boolean>,
  setSplitScroll: (ratio: number) => void,
) {
  if (lock.current) {
    return;
  }
  lock.current = true;
  setSplitScroll(ratio);
  window.requestAnimationFrame(() => {
    lock.current = false;
  });
}

export function editorGridClass(
  viewMode: EditorMode,
  usesInternalScroll: boolean,
  cn: (...inputs: Array<string | false | undefined>) => string,
): string {
  return cn(
    "grid min-h-0 flex-1 [&>*]:min-h-0",
    viewMode === "split" &&
      "grid-cols-2 max-[900px]:grid-cols-1 [&>:first-child]:border-r [&>:first-child]:border-border",
    viewMode !== "split" && "grid-cols-1",
    viewMode === "preview" && "block",
    usesInternalScroll && "overflow-hidden",
  );
}

export function sourceLineNumbers(viewMode: EditorMode): boolean {
  return viewMode === "source" || viewMode === "split";
}

export function ownerLabelFor(user: SessionUser | null): string {
  return user?.displayName?.trim() || user?.email || "オーナー";
}

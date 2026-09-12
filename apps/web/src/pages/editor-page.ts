import type { Note, SessionUser } from "@miyulabmd/shared";
import { titleFromMarkdown } from "@miyulabmd/shared";
import type { MutableRefObject } from "react";
import type { AccessDraft } from "../components/notes/AccessPanel.tsx";
import {
  draftFromNote,
  noteAccessPatch,
} from "../components/notes/access-draft.ts";
import type { ApiFailure, ApiResult } from "../lib/api.ts";
import { fetchArticleSources, updateNote } from "../lib/api.ts";
import { applyAwarenessUser } from "../lib/collaboration.ts";
import {
  type CollabSessionSnapshot,
  createNoteCollabSession,
  type NoteCollabSession,
} from "../lib/collaboration-session.ts";
import { acquireDraftLock } from "../lib/draft-lock.ts";
import {
  getDraft,
  type LocalDraft,
  type LocalDraftId,
} from "../lib/draft-store.ts";
import { type EditorMode, writeEditorMode } from "../lib/editor-mode.ts";
import { canCreateLocalDraft } from "../lib/home-draft-list.ts";
import {
  getLocalDraftEditor,
  openLocalDraftEditor,
} from "../lib/local-draft-editor.ts";
import { loadOgCards } from "../lib/markdown.ts";
import { readNoteBootstrap } from "../lib/note-bootstrap.ts";
import {
  getLoadedNoteMeta,
  loadNoteRecord,
  noteFromCaches,
  seedNoteCache,
} from "../lib/note-cache.ts";
import { getHydratableScope } from "../lib/offline-scope.ts";
import type { SessionSnapshot } from "../lib/offline-session.ts";
import { evictNotesEverywhere } from "../lib/offline-session.ts";
import {
  nextRequestGeneration,
  type RequestGeneration,
  type SessionEpoch,
} from "../lib/offline-types.ts";

export type EditorViewPhase =
  | "loading"
  | "cached-preview"
  | "revalidating"
  | "offline-preview"
  | "server-preview"
  | "preparing-edit"
  | "editing"
  | "uncached"
  | "denied"
  | "not-found"
  | "load-error"
  | "local-editing"
  | "local-readonly";

export type EditorPreviewMeta = {
  source: "memory" | "idb" | "server" | "ssr";
  cachedAt: number | null;
  verifiedForSession: boolean;
};

export type EditorLoadContext = {
  routeId: string;
  generation: RequestGeneration;
  sessionEpoch: SessionEpoch;
};

export type EditorDocumentModel =
  | { kind: "server"; note: Note }
  | { kind: "draft"; draft: LocalDraft };

export type EditorNoteSnapshot = {
  document: EditorDocumentModel | null;
  note: Note | null;
  markdown: string;
  folder: string;
  accessDraft: AccessDraft | null;
  loadError: string | null;
  previewBanner: string | null;
  meta: EditorPreviewMeta | null;
  pendingEdit: boolean;
  viewPhase: EditorViewPhase;
};

export type ApplyEditorLoadOutcome = {
  stale: boolean;
  snapshot: Partial<EditorNoteSnapshot>;
  evictIds?: string[];
};

export type NoteSetters = {
  setNote: (note: Note | null) => void;
  setMarkdown: (markdown: string) => void;
  setFolder: (folder: string) => void;
  setAccessDraft: (draft: AccessDraft | null) => void;
};

const TERMINAL_PHASES = new Set<EditorViewPhase>([
  "uncached",
  "denied",
  "not-found",
  "load-error",
]);

const LOCAL_PHASES = new Set<EditorViewPhase>([
  "local-editing",
  "local-readonly",
]);

export function isLocalDraftId(id: string): boolean {
  return id.startsWith("local-");
}

/** Server notes reload on focus/online; local drafts keep the in-memory editor. */
export function shouldReloadEditorOnFocus(routeId: string): boolean {
  return !isLocalDraftId(routeId);
}

export function isOfflineKnownSession(session: SessionSnapshot): boolean {
  return session.status === "offline-known";
}

export function isSessionHydratable(_session: SessionSnapshot): boolean {
  return getHydratableScope() !== null;
}

export function noteAllowsEdit(note: Note | null): boolean {
  return Boolean(note?.access.flags.canEdit);
}

/** Cache metadata must not authorize Edit. Server GET + verifiedForSession only. */
export function verifiedCanEdit(
  note: Note | null,
  meta: EditorPreviewMeta | null,
): boolean {
  return Boolean(note && meta?.verifiedForSession && note.access.flags.canEdit);
}

export function canStartEdit(input: {
  routeId?: string;
  phase: EditorViewPhase;
  note: Note | null;
  meta: EditorPreviewMeta | null;
  session: SessionSnapshot;
  pendingEdit: boolean;
  collabActive: boolean;
}): boolean {
  if (input.routeId && isLocalDraftId(input.routeId)) {
    return input.phase === "local-editing";
  }
  if (isOfflineKnownSession(input.session)) {
    return input.phase === "editing" && input.collabActive;
  }
  if (input.session.status === "unknown") {
    return false;
  }
  if (input.session.status === "verification-error") {
    return false;
  }
  if (input.session.status === "unauthenticated") {
    return false;
  }
  if (!verifiedCanEdit(input.note, input.meta)) {
    return false;
  }
  if (input.phase === "preparing-edit" || input.phase === "editing") {
    return input.pendingEdit || input.collabActive;
  }
  return input.phase === "server-preview";
}

export function allowsServerMutations(
  phase: EditorViewPhase,
  session: SessionSnapshot,
): boolean {
  if (LOCAL_PHASES.has(phase)) {
    return false;
  }
  if (isOfflineKnownSession(session)) {
    return false;
  }
  if (TERMINAL_PHASES.has(phase)) {
    return false;
  }
  return phase === "server-preview" || phase === "editing";
}

export function allowsTaskCheckboxMutations(
  phase: EditorViewPhase,
  session: SessionSnapshot,
  note: Note | null,
  meta: EditorPreviewMeta | null,
): boolean {
  if (isOfflineKnownSession(session)) {
    return false;
  }
  if (!verifiedCanEdit(note, meta)) {
    return false;
  }
  return phase === "server-preview";
}

export function taskNoteIdFor(input: {
  phase: EditorViewPhase;
  note: Note | null;
  meta: EditorPreviewMeta | null;
  session: SessionSnapshot;
}): string | undefined {
  if (
    !(
      input.note &&
      allowsTaskCheckboxMutations(
        input.phase,
        input.session,
        input.note,
        input.meta,
      )
    )
  ) {
    return undefined;
  }
  return input.note.id;
}

export function editorNeedsSession(phase: EditorViewPhase): boolean {
  return phase === "preparing-edit" || phase === "editing";
}

export function editorDesiredConnection(phase: EditorViewPhase): boolean {
  return phase === "preparing-edit" || phase === "editing";
}

export function isLocalEditorPhase(phase: EditorViewPhase): boolean {
  return LOCAL_PHASES.has(phase);
}

export function editorViewModeFor(input: {
  requestedMode: EditorMode;
  phase: EditorViewPhase;
  canStartEdit: boolean;
}): EditorMode {
  if (
    (input.phase === "editing" || input.phase === "local-editing") &&
    input.canStartEdit
  ) {
    return input.requestedMode;
  }
  if (input.phase === "local-readonly") {
    return "preview";
  }
  return "preview";
}

export function shouldRemoveSsrPreview(phase: EditorViewPhase): boolean {
  return phase !== "loading";
}

export function formatCachedAt(cachedAt: number | null): string | null {
  if (cachedAt === null) {
    return null;
  }
  return new Date(cachedAt).toLocaleString();
}

export function previewBannerFor(
  phase: EditorViewPhase,
  meta: EditorPreviewMeta | null,
): string | null {
  if (phase === "offline-preview") {
    return "オフライン: 端末に保存された内容を表示しています";
  }
  if (phase === "cached-preview" || phase === "revalidating") {
    const when = formatCachedAt(meta?.cachedAt ?? null);
    if (when) {
      return phase === "revalidating"
        ? `保存済み (${when}) · 再確認中…`
        : `保存済み (${when}) · 再確認中…`;
    }
    return phase === "revalidating"
      ? "再確認中…"
      : "保存済みの内容を表示しています";
  }
  return null;
}

export function emptyEditorSnapshot(): EditorNoteSnapshot {
  return {
    accessDraft: null,
    document: null,
    folder: "",
    loadError: null,
    markdown: "",
    meta: null,
    note: null,
    pendingEdit: false,
    previewBanner: null,
    viewPhase: "loading",
  };
}

export function resetEditorSnapshotForRoute(
  routeId: string,
): EditorNoteSnapshot {
  if (isLocalDraftId(routeId)) {
    return emptyEditorSnapshot();
  }
  return emptyEditorSnapshot();
}

export function noteViewFromLocalDraft(draft: LocalDraft): Note {
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
    markdown: draft.markdown,
    ownerId: draft.ownerId,
    permission: "private",
    shortId: draft.localId,
    title: titleFromMarkdown(draft.markdown) || "無題",
    updatedAt: draft.updatedAt,
  };
}

export function snapshotFromLocalDraft(
  draft: LocalDraft,
  phase: EditorViewPhase,
  banner: string | null = null,
): EditorNoteSnapshot {
  const note = noteViewFromLocalDraft(draft);
  return {
    accessDraft: draftFromNote(note),
    document: { draft, kind: "draft" },
    folder: draft.folder,
    loadError: null,
    markdown: draft.markdown,
    meta: null,
    note,
    pendingEdit: phase === "local-editing",
    previewBanner: banner,
    viewPhase: phase,
  };
}

function metaFromLoaded(
  source: EditorPreviewMeta["source"],
  cachedAt: number | null,
  verifiedForSession: boolean,
): EditorPreviewMeta {
  return { cachedAt, source, verifiedForSession };
}

function readAllowedPreview(routeId: string): {
  note: Note;
  meta: EditorPreviewMeta;
} | null {
  const boot = readNoteBootstrap(routeId);
  if (boot) {
    seedNoteCache(boot);
    return {
      meta: metaFromLoaded("ssr", null, false),
      note: boot,
    };
  }
  const scope = getHydratableScope();
  if (!scope) {
    return null;
  }
  const hit = noteFromCaches(routeId);
  if (!hit) {
    return null;
  }
  const loaded = getLoadedNoteMeta(routeId);
  return {
    meta: loaded
      ? {
          cachedAt: loaded.cachedAt,
          source: loaded.source,
          verifiedForSession: loaded.verifiedForSession,
        }
      : metaFromLoaded("memory", null, false),
    note: hit,
  };
}

export function beginEditorPreviewHydrate(routeId: string): {
  preview: { note: Note; meta: EditorPreviewMeta } | null;
  phase: EditorViewPhase;
} {
  if (isLocalDraftId(routeId)) {
    return { phase: "loading", preview: null };
  }
  const preview = readAllowedPreview(routeId);
  if (!preview) {
    return { phase: "loading", preview: null };
  }
  return { phase: "cached-preview", preview };
}

export function snapshotFromPreview(
  preview: { note: Note; meta: EditorPreviewMeta },
  phase: EditorViewPhase = "cached-preview",
): Omit<EditorNoteSnapshot, "pendingEdit"> {
  return {
    accessDraft: draftFromNote(preview.note),
    document: { kind: "server", note: preview.note },
    folder: preview.note.folder,
    loadError: null,
    markdown: preview.note.markdown,
    meta: preview.meta,
    note: preview.note,
    previewBanner: previewBannerFor(phase, preview.meta),
    viewPhase: phase,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: view phase state machine
export function resolveEditorViewPhase(input: {
  routeId: string;
  pendingEdit: boolean;
  hasPreview: boolean;
  loadError: string | null;
  note: Note | null;
  meta: EditorPreviewMeta | null;
  revalidating: boolean;
  collabReady: boolean;
  collabActive: boolean;
  explicitPhase?: EditorViewPhase | null;
}): EditorViewPhase {
  if (isLocalDraftId(input.routeId)) {
    if (input.explicitPhase && LOCAL_PHASES.has(input.explicitPhase)) {
      return input.explicitPhase;
    }
    if (input.loadError && !input.hasPreview) {
      return "load-error";
    }
    return input.explicitPhase ?? "local-editing";
  }
  if (input.explicitPhase && TERMINAL_PHASES.has(input.explicitPhase)) {
    return input.explicitPhase;
  }
  if (input.loadError && !input.hasPreview) {
    if (input.explicitPhase === "denied") {
      return "denied";
    }
    if (input.explicitPhase === "not-found") {
      return "not-found";
    }
    if (input.explicitPhase === "uncached") {
      return "uncached";
    }
    return "load-error";
  }
  if (input.pendingEdit) {
    if (input.collabReady && input.collabActive) {
      return "editing";
    }
    if (input.hasPreview && verifiedCanEdit(input.note, input.meta)) {
      return "preparing-edit";
    }
  }
  if (input.explicitPhase === "offline-preview") {
    return "offline-preview";
  }
  if (input.revalidating && input.hasPreview) {
    return "revalidating";
  }
  if (input.meta?.verifiedForSession && input.note) {
    return "server-preview";
  }
  if (input.hasPreview) {
    return "cached-preview";
  }
  if (input.revalidating) {
    return "loading";
  }
  return "loading";
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

function serverFailureRequiresEviction(result: ApiFailure): boolean {
  return (
    result.kind === "http" && (result.status === 403 || result.status === 404)
  );
}

function isServerOutage(result: ApiFailure): boolean {
  return result.kind === "http" && result.status >= 500;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: force GET error table
export function applyEditorForceLoadResult(input: {
  ctx: EditorLoadContext;
  result: ApiResult<{ note: Note } & EditorPreviewMeta>;
  hadPreview: boolean;
  currentGeneration: RequestGeneration;
  currentSessionEpoch: SessionEpoch;
}): ApplyEditorLoadOutcome {
  const { ctx, result, hadPreview } = input;
  if (
    input.currentGeneration !== ctx.generation ||
    input.currentSessionEpoch !== ctx.sessionEpoch
  ) {
    return { snapshot: {}, stale: true };
  }

  if (result.ok) {
    const note = result.data.note ?? (result.data as unknown as Note);
    const meta: EditorPreviewMeta = {
      cachedAt: result.data.cachedAt ?? Date.now(),
      source: result.data.source ?? "server",
      verifiedForSession: result.data.verifiedForSession,
    };
    void loadOgCards(note.markdown);
    return {
      snapshot: {
        ...snapshotFromPreview({ meta, note }, "server-preview"),
        previewBanner: previewBannerFor("server-preview", meta),
        viewPhase: "server-preview",
      },
      stale: false,
    };
  }

  if (result.kind === "aborted") {
    return { snapshot: {}, stale: true };
  }

  if (result.kind === "network") {
    if (hadPreview) {
      const phase: EditorViewPhase = "offline-preview";
      return {
        snapshot: {
          loadError: null,
          previewBanner: previewBannerFor(phase, null),
          viewPhase: phase,
        },
        stale: false,
      };
    }
    return {
      snapshot: {
        ...emptyEditorSnapshot(),
        loadError:
          "まだキャッシュされていません。オンラインで一度開いてください。",
        viewPhase: "uncached",
      },
      stale: false,
    };
  }

  if (isServerOutage(result)) {
    if (hadPreview) {
      const phase: EditorViewPhase = "offline-preview";
      return {
        snapshot: {
          loadError: null,
          previewBanner:
            `${previewBannerFor(phase, null) ?? ""}（サーバー障害のため read-only）`.trim(),
          viewPhase: phase,
        },
        stale: false,
      };
    }
    return {
      snapshot: {
        ...emptyEditorSnapshot(),
        loadError: result.error,
        viewPhase: "load-error",
      },
      stale: false,
    };
  }

  if (result.kind === "http" && result.status === 401) {
    return {
      snapshot: {
        ...emptyEditorSnapshot(),
        loadError: noteLoadErrorMessage(401, result.error),
        viewPhase: "denied",
      },
      stale: false,
    };
  }

  if (serverFailureRequiresEviction(result)) {
    const phase: EditorViewPhase =
      result.status === 404 ? "not-found" : "denied";
    return {
      evictIds: [ctx.routeId],
      snapshot: {
        ...emptyEditorSnapshot(),
        loadError: noteLoadErrorMessage(result.status, result.error),
        viewPhase: phase,
      },
      stale: false,
    };
  }

  if (result.kind === "invalid-response") {
    return {
      snapshot: {
        ...(hadPreview
          ? {}
          : {
              ...emptyEditorSnapshot(),
            }),
        loadError: result.error,
        viewPhase: "load-error",
      },
      stale: false,
    };
  }

  return {
    snapshot: {
      ...emptyEditorSnapshot(),
      loadError: result.error,
      viewPhase: "load-error",
    },
    stale: false,
  };
}

export function applyLoadedNote(loaded: Note, setters: NoteSetters) {
  setters.setNote(loaded);
  setters.setMarkdown(loaded.markdown);
  setters.setFolder(loaded.folder);
  setters.setAccessDraft(draftFromNote(loaded));
}

export function requestEditorEdit(input: {
  phase: EditorViewPhase;
  note: Note | null;
  meta: EditorPreviewMeta | null;
  session: SessionSnapshot;
}): boolean {
  return canStartEdit({
    collabActive: false,
    meta: input.meta,
    note: input.note,
    pendingEdit: false,
    phase: input.phase,
    routeId: "",
    session: input.session,
  });
}

export function editorModeSwitchVisible(
  phase: EditorViewPhase,
  session: SessionSnapshot,
  collabActive: boolean,
): boolean {
  if (TERMINAL_PHASES.has(phase)) {
    return false;
  }
  if (phase === "local-editing" || phase === "local-readonly") {
    return phase === "local-editing";
  }
  if (phase === "offline-preview" || phase === "cached-preview") {
    return false;
  }
  if (phase === "revalidating") {
    return false;
  }
  if (isOfflineKnownSession(session)) {
    return phase === "editing" && collabActive;
  }
  return (
    phase === "server-preview" ||
    phase === "preparing-edit" ||
    phase === "editing"
  );
}

export function editorHeaderMutationsVisible(
  phase: EditorViewPhase,
  session: SessionSnapshot,
  collabActive: boolean,
): boolean {
  if (LOCAL_PHASES.has(phase)) {
    return false;
  }
  return editorModeSwitchVisible(phase, session, collabActive);
}

export function subscribeLocalDraftLoad(input: {
  routeId: LocalDraftId;
  user: SessionUser | null;
  session: SessionSnapshot;
  onSnapshot: (snapshot: EditorNoteSnapshot) => void;
}): () => void {
  let cancelled = false;
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: draft lock, hydrate, and deny paths
  void (async () => {
    if (!canCreateLocalDraft(input.session, input.user)) {
      if (!cancelled) {
        input.onSnapshot({
          ...emptyEditorSnapshot(),
          loadError: "ログインしてから下書きを開いてください。",
          viewPhase: "denied",
        });
      }
      return;
    }
    const ownerId = input.user?.id;
    if (!ownerId) {
      if (!cancelled) {
        input.onSnapshot({
          ...emptyEditorSnapshot(),
          loadError: "ログインしてから下書きを開いてください。",
          viewPhase: "denied",
        });
      }
      return;
    }
    const existing = getLocalDraftEditor(ownerId, input.routeId);
    if (existing) {
      if (!cancelled) {
        const phase: EditorViewPhase = existing.readonly
          ? "local-readonly"
          : "local-editing";
        const banner = existing.readonly
          ? "別タブで編集中です。このタブは read-only です。"
          : "端末にのみ保存された下書きです（未保存）";
        input.onSnapshot(snapshotFromLocalDraft(existing.draft, phase, banner));
      }
      return;
    }
    const draft = await getDraft(ownerId, input.routeId);
    if (cancelled) {
      return;
    }
    if (!draft || draft.ownerId !== ownerId) {
      input.onSnapshot({
        ...emptyEditorSnapshot(),
        loadError: "下書きが見つからないか、別アカウントの下書きです。",
        viewPhase: "not-found",
      });
      return;
    }
    const lock = await acquireDraftLock(ownerId, input.routeId);
    if (cancelled) {
      lock?.release();
      return;
    }
    const phase: EditorViewPhase = lock ? "local-editing" : "local-readonly";
    const banner = lock
      ? "端末にのみ保存された下書きです（未保存）"
      : "別タブで編集中です。このタブは read-only です。";
    const snapshot = snapshotFromLocalDraft(draft, phase, banner);
    if (lock && input.user) {
      openLocalDraftEditor({
        draft,
        lock,
        sessionEpoch: input.session.sessionEpoch,
        user: input.user,
      });
    }
    input.onSnapshot(snapshot);
  })();
  return () => {
    cancelled = true;
  };
}

export function subscribeEditorNoteLoad(input: {
  routeId: string;
  generation: RequestGeneration;
  sessionEpoch: SessionEpoch;
  user: SessionUser | null;
  session: SessionSnapshot;
  onPreview: (snapshot: Partial<EditorNoteSnapshot>) => void;
  onRevalidating: () => void;
  onResult: (outcome: ApplyEditorLoadOutcome) => void;
}): () => void {
  if (isLocalDraftId(input.routeId)) {
    return subscribeLocalDraftLoad({
      onSnapshot: (snapshot) => {
        input.onPreview(snapshot);
      },
      routeId: input.routeId as LocalDraftId,
      session: input.session,
      user: input.user,
    });
  }

  const hydrate = beginEditorPreviewHydrate(input.routeId);
  if (hydrate.preview) {
    input.onPreview(snapshotFromPreview(hydrate.preview, hydrate.phase));
  }

  let cancelled = false;
  const hadPreview = Boolean(hydrate.preview);
  input.onRevalidating();

  void loadNoteRecord(input.routeId, true).then((result) => {
    if (cancelled) {
      return;
    }
    const normalized = result.ok
      ? {
          data: {
            cachedAt: result.data.cachedAt,
            note: result.data.note,
            source: result.data.source,
            verifiedForSession: result.data.verifiedForSession,
          },
          ok: true as const,
        }
      : result;
    input.onResult(
      applyEditorForceLoadResult({
        ctx: {
          generation: input.generation,
          routeId: input.routeId,
          sessionEpoch: input.sessionEpoch,
        },
        currentGeneration: input.generation,
        currentSessionEpoch: input.sessionEpoch,
        hadPreview,
        result: normalized,
      }),
    );
  });

  return () => {
    cancelled = true;
  };
}

export function applyEditorNoteLoad(
  result: ApiResult<Note>,
  id: string,
  hit: Note | undefined,
  cancelled: boolean,
  setters: NoteSetters & {
    setLoadError: (error: string | null) => void;
    setLoading: (loading: boolean) => void;
  },
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
  guard?: () => boolean,
) {
  if (!note || guard?.() === false) {
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
  guard?: () => boolean,
) {
  if (!note || guard?.() === false) {
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

export function handleCollabAuthStop(input: {
  snapshot: EditorNoteSnapshot;
  collabSnapshot: CollabSessionSnapshot;
}): Partial<EditorNoteSnapshot> {
  if (input.collabSnapshot.denied || input.collabSnapshot.authStopped) {
    return {
      ...emptyEditorSnapshot(),
      loadError: input.collabSnapshot.denied
        ? "このノートを表示する権限がありません。"
        : "このノートを表示するにはログインが必要です。",
      pendingEdit: false,
      viewPhase: "denied",
    };
  }
  if (input.collabSnapshot.editDenied) {
    return {
      pendingEdit: false,
      viewPhase: "server-preview",
    };
  }
  return {};
}

function isTerminalLoadClear(snapshot: Partial<EditorNoteSnapshot>): boolean {
  return Boolean(snapshot.viewPhase && TERMINAL_PHASES.has(snapshot.viewPhase));
}

export function applyEditorLoadOutcome(
  outcome: ApplyEditorLoadOutcome,
  current: EditorNoteSnapshot,
): EditorNoteSnapshot {
  if (outcome.stale) {
    return current;
  }
  if (outcome.evictIds?.length) {
    evictNotesEverywhere(outcome.evictIds, "editor-load-denied");
  }
  const merged: EditorNoteSnapshot = { ...current, ...outcome.snapshot };
  if (
    !isTerminalLoadClear(outcome.snapshot) &&
    outcome.snapshot.pendingEdit === undefined
  ) {
    merged.pendingEdit = current.pendingEdit;
  }
  return merged;
}

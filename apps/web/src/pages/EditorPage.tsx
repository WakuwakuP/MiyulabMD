import type { ArticleSource, Note } from "@miyulabmd/shared";
import {
  matchArticleSource,
  normalizeFolder,
  titleFromMarkdown,
  validateArticleDocument,
} from "@miyulabmd/shared";
import {
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link, useNavigate, useOutletContext, useParams } from "react-router";
import { EditorModeSwitch } from "../components/editor/EditorModeSwitch.tsx";
import { FolderPopover } from "../components/editor/FolderPopover.tsx";
import { HistoryPanel } from "../components/editor/HistoryPanel.tsx";
import { MarkdownEditor } from "../components/editor/MarkdownEditor.tsx";
import { MarkdownPreview } from "../components/editor/MarkdownPreview.tsx";
import { PresenceBar } from "../components/editor/PresenceBar.tsx";
import { PreviewWithToc } from "../components/editor/PreviewWithToc.tsx";
import { RichMarkdownEditor } from "../components/editor/RichMarkdownEditor.tsx";
import type { AppShellContext } from "../components/layout/AppShellContext.ts";
import type { AccessDraft } from "../components/notes/AccessPanel.tsx";
import { ArticleFrontmatterAlert } from "../components/notes/ArticleFrontmatterAlert.tsx";
import { ShareModal } from "../components/notes/ShareModal.tsx";
import { HeaderButton } from "../components/ui/HeaderButton.tsx";
import { HistoryIcon, ShareIcon } from "../components/ui/icons.tsx";
import { editorLoadingClass } from "../components/ui/prose.ts";
import { ErrorText } from "../components/ui/Text.tsx";
import { cn } from "../lib/cn.ts";
import type { NoteCollabSession } from "../lib/collaboration-session.ts";
import {
  type CollabSessionSnapshot,
  collabBannerMessage,
} from "../lib/collaboration-session.ts";
import type { EditorMode } from "../lib/editor-mode.ts";
import {
  dismissStaleSsrPreview,
  removeSsrPreview,
} from "../lib/note-bootstrap.ts";
import {
  getSessionSnapshot,
  subscribeSession,
} from "../lib/offline-session.ts";
import { nextRequestGeneration } from "../lib/offline-types.ts";
import { subscribeOnlineStatus } from "../lib/online-status.ts";
import {
  allowsServerMutations,
  applyEditorLoadOutcome,
  applySplitScroll,
  bindEditorCollab,
  canStartEdit,
  changeEditorMode,
  type EditorNoteSnapshot,
  type EditorPreviewMeta,
  type EditorViewPhase,
  editorDesiredConnection,
  editorGridClass,
  editorHeaderMutationsVisible,
  editorModeSwitchVisible,
  editorNeedsSession,
  editorViewModeFor,
  handleCollabAuthStop,
  isLocalDraftId,
  isLocalEditorPhase,
  isOfflineKnownSession,
  ownerLabelFor,
  persistEditorAccess,
  persistEditorFolder,
  resetEditorSnapshotForRoute,
  resolveEditorViewPhase,
  shouldReloadEditorOnFocus,
  shouldRemoveSsrPreview,
  sourceLineNumbers,
  subscribeArticleSources,
  subscribeEditorNoteLoad,
  subscribeLocalDraftLoad,
  syncCollabUser,
  taskNoteIdFor,
  teardownCollab,
  verifiedCanEdit,
} from "./editor-page.ts";
import {
  getLocalDraftEditor,
  invalidateLocalDraftEditor,
  type LocalDraftEditor,
} from "../lib/local-draft-editor.ts";
import { isDraftStorageUnavailable, type LocalDraftId } from "../lib/draft-store.ts";
import {
  getPromotedServerId,
  registerDraftSyncNavigation,
  subscribeDraftPromotions,
} from "../lib/draft-sync.ts";

function EditorLoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  const showAuthLinks =
    message.includes("ログイン") || message.includes("権限");
  return (
    <section className="flex flex-col px-5 py-4">
      <ErrorText>{message}</ErrorText>
      {onRetry && (
        <p>
          <button onClick={onRetry} type="button">
            再試行
          </button>
        </p>
      )}
      {showAuthLinks && (
        <p>
          <Link to="/">ホームに戻る</Link>
          {" · "}
          <a href="/auth/login">ログイン</a>
        </p>
      )}
    </section>
  );
}

function EditorPreviewBanner({ message }: { message: string }) {
  return (
    <p className="border-border border-b px-5 py-2 text-muted text-sm">
      {message}
    </p>
  );
}

function EditorSourcePane({
  ready,
  yMarkdown,
  awareness,
  noteId,
  canEdit,
  viewMode,
  splitScroll,
  onSplitScroll,
}: {
  ready: boolean;
  yMarkdown: NoteCollabSession["yMarkdown"] | undefined;
  awareness: NoteCollabSession["awareness"] | undefined;
  noteId: string;
  canEdit: boolean;
  viewMode: EditorMode;
  splitScroll: number;
  onSplitScroll: (ratio: number) => void;
}) {
  if (ready && yMarkdown && awareness) {
    return (
      <MarkdownEditor
        awareness={awareness}
        lineNumbers={sourceLineNumbers(viewMode)}
        noteId={noteId}
        onScrollRatio={viewMode === "split" ? onSplitScroll : undefined}
        readOnly={!canEdit}
        scrollRatio={viewMode === "split" ? splitScroll : undefined}
        yText={yMarkdown}
      />
    );
  }
  return (
    <div className={editorLoadingClass}>
      <p>共同編集に接続中…</p>
    </div>
  );
}

function EditorPreviewPane({
  viewMode,
  markdown,
  splitScroll,
  onSplitScroll,
  taskNoteId,
}: {
  viewMode: EditorMode;
  markdown: string;
  splitScroll: number;
  onSplitScroll: (ratio: number) => void;
  taskNoteId?: string;
}) {
  if (viewMode === "preview") {
    return (
      <PreviewWithToc
        documentScroll={true}
        markdown={markdown}
        taskNoteId={taskNoteId}
      />
    );
  }
  return (
    <MarkdownPreview
      markdown={markdown}
      onScrollRatio={onSplitScroll}
      scrollRatio={splitScroll}
    />
  );
}

function EditorRichPane({
  ready,
  yMarkdown,
  awareness,
  noteId,
  canEdit,
}: {
  ready: boolean;
  yMarkdown: NoteCollabSession["yMarkdown"] | undefined;
  awareness: NoteCollabSession["awareness"] | undefined;
  noteId: string;
  canEdit: boolean;
}) {
  if (ready && yMarkdown && awareness) {
    return (
      <RichMarkdownEditor
        awareness={awareness}
        key={noteId}
        noteId={noteId}
        readOnly={!canEdit}
        yText={yMarkdown}
      />
    );
  }
  return (
    <div className={editorLoadingClass}>
      <p>共同編集に接続中…</p>
    </div>
  );
}

function EditorShareDialog({
  shareOpen,
  headingTitle,
  noteId,
  user,
  accessDraft,
  isOwner,
  saveError,
  onChange,
  onClose,
}: {
  shareOpen: boolean;
  headingTitle: string;
  noteId: string;
  user: AppShellContext["user"];
  accessDraft: AccessDraft;
  isOwner: boolean;
  saveError: string | null;
  onChange: (next: AccessDraft) => void;
  onClose: () => void;
}) {
  if (!shareOpen) {
    return null;
  }
  return (
    <ShareModal
      disabled={!isOwner}
      error={saveError}
      inheritLabel="ディレクトリの設定に従う"
      linkUrl={`${window.location.origin}/n/${noteId}`}
      onChange={onChange}
      onClose={onClose}
      ownerLabel={ownerLabelFor(user)}
      showInherit={isOwner}
      title={headingTitle}
      value={accessDraft}
    />
  );
}

function CollabStatusBanner({
  message,
  live,
}: {
  message: string;
  live: boolean;
}) {
  return (
    <p
      aria-live={live ? "polite" : undefined}
      className="border-border border-b px-5 py-2 text-muted text-sm"
    >
      {message}
    </p>
  );
}

function EditorWorkspace({
  note,
  markdown,
  accessDraft,
  saveError,
  previewBanner,
  collabBanner,
  collabBannerLive,
  articleSource,
  articleIssues,
  viewMode,
  viewPhase,
  usesInternalScroll,
  ready,
  yMarkdown,
  awareness,
  canEdit,
  splitScroll,
  shareOpen,
  historyOpen,
  headingTitle,
  user,
  isOwner,
  taskNoteId,
  onSplitScroll,
  onPersistAccess,
  onCloseShare,
  onCloseHistory,
}: {
  note: Note;
  markdown: string;
  accessDraft: AccessDraft;
  saveError: string | null;
  previewBanner: string | null;
  collabBanner: string | null;
  collabBannerLive: boolean;
  articleSource: ArticleSource | null;
  articleIssues: ReturnType<typeof validateArticleDocument>["issues"];
  viewMode: EditorMode;
  viewPhase: EditorViewPhase;
  usesInternalScroll: boolean;
  ready: boolean;
  yMarkdown: NoteCollabSession["yMarkdown"] | undefined;
  awareness: NoteCollabSession["awareness"] | undefined;
  canEdit: boolean;
  splitScroll: number;
  shareOpen: boolean;
  historyOpen: boolean;
  headingTitle: string;
  user: AppShellContext["user"];
  isOwner: boolean;
  taskNoteId?: string;
  onSplitScroll: (ratio: number) => void;
  onPersistAccess: (next: AccessDraft) => void;
  onCloseShare: () => void;
  onCloseHistory: () => void;
}) {
  const showSource = viewMode === "split" || viewMode === "source";
  const showPreview = viewMode === "split" || viewMode === "preview";
  const showRich = viewMode === "rich";
  const editorCanEdit =
    canEdit && (viewPhase === "editing" || viewPhase === "local-editing");
  return (
    <section
      className={cn("flex flex-col", usesInternalScroll && "h-full min-h-0")}
    >
      {previewBanner && <EditorPreviewBanner message={previewBanner} />}
      {collabBanner && (
        <CollabStatusBanner live={collabBannerLive} message={collabBanner} />
      )}
      {saveError && <ErrorText className="px-5 py-4">{saveError}</ErrorText>}
      {articleSource && <ArticleFrontmatterAlert issues={articleIssues} />}
      <div className={editorGridClass(viewMode, usesInternalScroll, cn)}>
        {showSource && (
          <EditorSourcePane
            awareness={awareness}
            canEdit={editorCanEdit}
            noteId={note.id}
            onSplitScroll={onSplitScroll}
            ready={ready}
            splitScroll={splitScroll}
            viewMode={viewMode}
            yMarkdown={yMarkdown}
          />
        )}
        {showPreview && (
          <EditorPreviewPane
            markdown={markdown}
            onSplitScroll={onSplitScroll}
            splitScroll={splitScroll}
            taskNoteId={taskNoteId}
            viewMode={viewMode}
          />
        )}
        {showRich && (
          <EditorRichPane
            awareness={awareness}
            canEdit={editorCanEdit}
            noteId={note.id}
            ready={ready}
            yMarkdown={yMarkdown}
          />
        )}
      </div>
      <EditorShareDialog
        accessDraft={accessDraft}
        headingTitle={headingTitle}
        isOwner={isOwner}
        noteId={note.id}
        onChange={onPersistAccess}
        onClose={onCloseShare}
        saveError={saveError}
        shareOpen={shareOpen}
        user={user}
      />
      {historyOpen && (
        <HistoryPanel
          canEdit={editorCanEdit}
          noteId={note.id}
          onClose={onCloseHistory}
        />
      )}
    </section>
  );
}

function EditorPageView({
  viewPhase,
  loadError,
  note,
  accessDraft,
  workspace,
  onRetry,
}: {
  viewPhase: EditorViewPhase;
  loadError: string | null;
  note: Note | null;
  accessDraft: AccessDraft | null;
  workspace: ReactNode;
  onRetry?: () => void;
}) {
  if (viewPhase === "loading" && !(note && accessDraft)) {
    return (
      <section className="flex flex-col px-5 py-4">
        <p>読み込み中…</p>
      </section>
    );
  }
  if (
    loadError &&
    !(note && accessDraft) &&
    (viewPhase === "uncached" ||
      viewPhase === "denied" ||
      viewPhase === "not-found" ||
      viewPhase === "load-error")
  ) {
    return <EditorLoadError message={loadError} onRetry={onRetry} />;
  }
  if (!(note && accessDraft)) {
    return null;
  }
  return workspace;
}

function EditorHeaderEnd({
  awareness,
  folder,
  folderId,
  isOwner,
  onFolderChange,
  onFolderBlur,
  onHistory,
  onShare,
}: {
  awareness: NoteCollabSession["awareness"] | undefined;
  folder: string;
  folderId: string | null;
  isOwner: boolean;
  onFolderChange: (folder: string) => void;
  onFolderBlur: () => void;
  onHistory: () => void;
  onShare: () => void;
}) {
  return (
    <>
      {awareness && <PresenceBar awareness={awareness} />}
      <FolderPopover
        folder={folder}
        folderId={folderId}
        isOwner={isOwner}
        onFolderBlur={onFolderBlur}
        onFolderChange={onFolderChange}
      />
      <HeaderButton icon={<HistoryIcon />} label="履歴" onClick={onHistory} />
      <HeaderButton
        icon={<ShareIcon />}
        label="共有"
        onClick={onShare}
        variant="accent"
      />
    </>
  );
}

function ownerFlags(user: AppShellContext["user"], note: Note | null) {
  return {
    canEdit: Boolean(note?.access.flags.canEdit),
    isOwner: Boolean(user && note && user.id === note.ownerId),
  };
}

function articleIssuesFor(
  articleSource: ArticleSource | null,
  markdown: string,
) {
  if (!articleSource) {
    return [];
  }
  return validateArticleDocument(articleSource.schema, markdown).issues;
}

function applySnapshot(
  snapshot: Partial<EditorNoteSnapshot>,
  setters: {
    setNote: (note: Note | null) => void;
    setMarkdown: (markdown: string) => void;
    setFolder: (folder: string) => void;
    setAccessDraft: (draft: AccessDraft | null) => void;
    setLoadError: (error: string | null) => void;
    setPreviewBanner: (banner: string | null) => void;
    setMeta: (meta: EditorPreviewMeta | null) => void;
    setPendingEdit: (pending: boolean) => void;
    setViewPhase: (phase: EditorViewPhase) => void;
  },
) {
  if (snapshot.note !== undefined) {
    setters.setNote(snapshot.note);
  }
  if (snapshot.markdown !== undefined) {
    setters.setMarkdown(snapshot.markdown);
  }
  if (snapshot.folder !== undefined) {
    setters.setFolder(snapshot.folder);
  }
  if (snapshot.accessDraft !== undefined) {
    setters.setAccessDraft(snapshot.accessDraft);
  }
  if (snapshot.loadError !== undefined) {
    setters.setLoadError(snapshot.loadError);
  }
  if (snapshot.previewBanner !== undefined) {
    setters.setPreviewBanner(snapshot.previewBanner);
  }
  if (snapshot.meta !== undefined) {
    setters.setMeta(snapshot.meta);
  }
  if (snapshot.pendingEdit !== undefined) {
    setters.setPendingEdit(snapshot.pendingEdit);
  }
  if (snapshot.viewPhase !== undefined) {
    setters.setViewPhase(snapshot.viewPhase);
  }
}

export function EditorPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { user, userLoading, setHeader } = useOutletContext<AppShellContext>();
  const [session, setSession] = useState(getSessionSnapshot);
  const initial = resetEditorSnapshotForRoute(id);
  const [note, setNote] = useState<Note | null>(initial.note);
  const [markdown, setMarkdown] = useState(initial.markdown);
  const [folder, setFolder] = useState(initial.folder);
  const [accessDraft, setAccessDraft] = useState<AccessDraft | null>(
    initial.accessDraft,
  );
  const [loadError, setLoadError] = useState<string | null>(initial.loadError);
  const [previewBanner, setPreviewBanner] = useState<string | null>(
    initial.previewBanner,
  );
  const [meta, setMeta] = useState<EditorPreviewMeta | null>(initial.meta);
  const [pendingEdit, setPendingEdit] = useState(initial.pendingEdit);
  const [viewPhase, setViewPhase] = useState<EditorViewPhase>(
    initial.viewPhase,
  );
  const [revalidating, setRevalidating] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [collab, setCollab] = useState<NoteCollabSession | null>(null);
  const [collabReady, setCollabReady] = useState(false);
  const [collabSnapshot, setCollabSnapshot] =
    useState<CollabSessionSnapshot | null>(null);
  const collabBannerRef = useRef<string | null>(null);
  const [collabBannerLive, setCollabBannerLive] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [articleSources, setArticleSources] = useState<ArticleSource[]>([]);
  const [mode, setMode] = useState<EditorMode>("preview");
  const [splitScroll, setSplitScroll] = useState(0);
  const splitScrollLock = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const [localEditor, setLocalEditor] = useState<LocalDraftEditor | null>(null);
  const sessionRef = useRef<NoteCollabSession | null>(null);
  const unbindCollabRef = useRef<(() => void) | null>(null);
  const loadGenerationRef = useRef(nextRequestGeneration());
  const loadSessionEpochRef = useRef(session.sessionEpoch);
  const editorSnapshotRef = useRef<EditorNoteSnapshot>(initial);
  const [loadTick, setLoadTick] = useState(0);

  const noteId = note?.id;
  const userId = user?.id;
  const flags = ownerFlags(user, note);
  const collabActive = Boolean(collab);
  const resolvedPhase = resolveEditorViewPhase({
    collabActive,
    collabReady,
    explicitPhase: viewPhase,
    hasPreview: Boolean(note && accessDraft),
    loadError,
    meta,
    note,
    pendingEdit,
    revalidating,
    routeId: id,
  });
  const startEditAllowed = canStartEdit({
    collabActive,
    meta,
    note,
    pendingEdit,
    phase: resolvedPhase,
    routeId: id,
    session,
  });
  const viewMode = editorViewModeFor({
    canStartEdit: startEditAllowed,
    phase: resolvedPhase,
    requestedMode: mode,
  });
  const usesInternalScroll = viewMode !== "preview";
  const headingTitle = titleFromMarkdown(markdown);
  const articleSource = matchArticleSource(folder, articleSources);
  const articleIssues = articleIssuesFor(articleSource, markdown);
  const awareness = localEditor?.awareness ?? collab?.awareness;
  const yMarkdown = localEditor?.yMarkdown ?? collab?.yMarkdown;
  const ready = Boolean(
    localEditor
      ? yMarkdown && awareness
      : yMarkdown && awareness && collabReady,
  );
  const localSaveBanner =
    localEditor?.saveState === "saving"
      ? "端末へ保存中…"
      : localEditor?.saveState === "error" || localEditor?.saveState === "conflict"
        ? (localEditor.saveError ?? "端末への保存に失敗しました。")
        : isDraftStorageUnavailable()
          ? "端末に保存できていません。内容はこのタブ内のみ保持されます。"
          : null;
  const collabBanner = collabSnapshot
    ? collabBannerMessage(collabSnapshot)
    : null;
  const taskNoteId = taskNoteIdFor({
    meta,
    note,
    phase: resolvedPhase,
    session,
  });
  const mutationGuard = () => allowsServerMutations(resolvedPhase, session);

  editorSnapshotRef.current = {
    accessDraft,
    document: localEditor
      ? { draft: localEditor.draft, kind: "draft" }
      : note
        ? { kind: "server", note }
        : null,
    folder,
    loadError,
    markdown,
    meta,
    note,
    pendingEdit,
    previewBanner,
    viewPhase: resolvedPhase,
  };

  const snapshotSetters = {
    setAccessDraft,
    setFolder,
    setLoadError,
    setMarkdown,
    setMeta,
    setNote,
    setPendingEdit,
    setPreviewBanner,
    setViewPhase,
  };

  const triggerReload = () => {
    if (!shouldReloadEditorOnFocus(id)) {
      return;
    }
    loadGenerationRef.current = nextRequestGeneration();
    loadSessionEpochRef.current = session.sessionEpoch;
    setLoadTick((value) => value + 1);
  };

  useEffect(() => subscribeSession(setSession), []);

  useEffect(() => {
    return registerDraftSyncNavigation(navigate, () =>
      isLocalDraftId(id) ? (id as LocalDraftId) : null,
    );
  }, [navigate, id]);

  useEffect(() => {
    if (!user?.id || !isLocalDraftId(id)) {
      return;
    }
    void getPromotedServerId(user.id, id as LocalDraftId).then((serverId) => {
      if (serverId) {
        navigate(`/n/${serverId}`, { replace: true });
      }
    });
    return subscribeDraftPromotions((ownerId, localId, serverId) => {
      if (ownerId === user.id && localId === id) {
        navigate(`/n/${serverId}`, { replace: true });
      }
    });
  }, [id, navigate, user?.id]);

  useEffect(() => {
    if (collabBanner === collabBannerRef.current) {
      return;
    }
    collabBannerRef.current = collabBanner;
    setCollabBannerLive(Boolean(collabBanner));
  }, [collabBanner]);

  useEffect(() => {
    dismissStaleSsrPreview(id);
    teardownCollab(
      unbindCollabRef,
      sessionRef,
      setCollab,
      setCollabReady,
      setCollabSnapshot,
    );
    setShareOpen(false);
    setHistoryOpen(false);
    setSaveError(null);
    setMode("preview");
    setPendingEdit(false);
    setRevalidating(false);
    setHydrated(false);
    setLocalEditor(null);
    loadGenerationRef.current = nextRequestGeneration();
    loadSessionEpochRef.current = session.sessionEpoch;
    applySnapshot(resetEditorSnapshotForRoute(id), snapshotSetters);
    return () => {
      if (user?.id && isLocalDraftId(id)) {
        void getLocalDraftEditor(user.id, id as `local-${string}`)?.flush();
        invalidateLocalDraftEditor(user.id, id as `local-${string}`);
      }
    };
  }, [id, session.sessionEpoch, user?.id]);

  useEffect(() => {
    if (!isLocalDraftId(id)) {
      return;
    }
    dismissStaleSsrPreview(id);
    return subscribeLocalDraftLoad({
      onSnapshot: (snapshot) => {
        applySnapshot(snapshot, snapshotSetters);
        if (user) {
          setLocalEditor(getLocalDraftEditor(user.id, id as `local-${string}`));
        }
        setHydrated(true);
      },
      routeId: id as `local-${string}`,
      session: getSessionSnapshot(),
      user,
    });
  }, [id, user?.id, session.sessionEpoch]);

  useEffect(() => {
    if (isLocalDraftId(id)) {
      return;
    }
    dismissStaleSsrPreview(id);
    return subscribeEditorNoteLoad({
      generation: loadGenerationRef.current,
      onPreview: (snapshot) => {
        applySnapshot(snapshot, snapshotSetters);
        setHydrated(true);
      },
      onResult: (outcome) => {
        setRevalidating(false);
        applySnapshot(
          applyEditorLoadOutcome(outcome, editorSnapshotRef.current),
          snapshotSetters,
        );
        setHydrated(true);
      },
      onRevalidating: () => {
        setRevalidating(true);
        setViewPhase("revalidating");
      },
      routeId: id,
      session: getSessionSnapshot(),
      sessionEpoch: loadSessionEpochRef.current,
      user,
    });
  }, [id, loadTick, session.sessionEpoch, user]);

  useEffect(() => {
    return subscribeOnlineStatus((online) => {
      if (online) {
        triggerReload();
      }
    });
  }, [id]);

  useEffect(() => {
    const onFocus = () => {
      triggerReload();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, [id]);

  useEffect(() => subscribeArticleSources(user, setArticleSources), [user]);

  useLayoutEffect(() => {
    dismissStaleSsrPreview(id);
    if (shouldRemoveSsrPreview(resolvedPhase)) {
      removeSsrPreview();
    }
  }, [id, resolvedPhase]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!usesInternalScroll) {
      root.classList.remove("editor-lock-viewport");
      return;
    }
    root.classList.add("editor-lock-viewport");
    return () => {
      root.classList.remove("editor-lock-viewport");
    };
  }, [usesInternalScroll]);

  useEffect(() => {
    return () => {
      teardownCollab(
        unbindCollabRef,
        sessionRef,
        setCollab,
        setCollabReady,
        setCollabSnapshot,
      );
    };
  }, [noteId, userId]);

  useEffect(() => {
    if (!collabSnapshot) {
      return;
    }
    const patch = handleCollabAuthStop({
      collabSnapshot,
      snapshot: editorSnapshotRef.current,
    });
    if (Object.keys(patch).length === 0) {
      return;
    }
    if (patch.pendingEdit === false) {
      setPendingEdit(false);
      setMode("preview");
    }
    if (patch.viewPhase) {
      setViewPhase(patch.viewPhase);
    }
    if (patch.loadError !== undefined) {
      setLoadError(patch.loadError);
    }
    if (patch.viewPhase === "denied") {
      setNote(null);
      setMarkdown("");
      setAccessDraft(null);
    }
  }, [collabSnapshot]);

  useEffect(() => {
    if (isLocalEditorPhase(resolvedPhase)) {
      return;
    }
    bindEditorCollab({
      desiredConnection: editorDesiredConnection(resolvedPhase),
      hydrated,
      needsSession: editorNeedsSession(resolvedPhase),
      noteId,
      sessionRef,
      setCollab,
      setCollabReady,
      setCollabSnapshot,
      setMarkdown,
      unbindRef: unbindCollabRef,
      user,
      userLoading,
    });
  }, [noteId, userLoading, resolvedPhase, hydrated, user]);

  useEffect(() => {
    if (resolvedPhase === "local-editing" && mode === "preview") {
      setMode("rich");
    }
  }, [resolvedPhase, id]);

  useEffect(() => {
    if (!localEditor || !user) {
      return;
    }
    const syncMarkdown = () => {
      setMarkdown(localEditor.yMarkdown.toString());
    };
    localEditor.yMarkdown.observe(syncMarkdown);
    const timer = window.setInterval(() => {
      const current = getLocalDraftEditor(
        user.id,
        id as `local-${string}`,
      );
      if (current) {
        setLocalEditor(current);
      }
    }, 500);
    const flush = () => {
      void localEditor.flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        flush();
      }
    });
    return () => {
      localEditor.yMarkdown.unobserve(syncMarkdown);
      window.clearInterval(timer);
      window.removeEventListener("pagehide", flush);
    };
  }, [localEditor?.draft.localId]);

  useEffect(() => {
    syncCollabUser(collab, user);
  }, [collab, user]);

  useEffect(() => {
    const previous = document.title;
    document.title = `${headingTitle} · MiyulabMD`;
    return () => {
      document.title = previous;
    };
  }, [headingTitle]);

  useEffect(() => {
    bindEditorHeader({
      awareness,
      canEdit: startEditAllowed,
      folder,
      headerVisible: editorModeSwitchVisible(
        resolvedPhase,
        session,
        collabActive,
      ),
      serverMutationsVisible: editorHeaderMutationsVisible(
        resolvedPhase,
        session,
        collabActive,
      ),
      isOwner: flags.isOwner,
      note,
      onRequestEdit: (next) => {
        if (next === "preview") {
          setPendingEdit(false);
          setMode("preview");
          return;
        }
        if (
          (resolvedPhase === "editing" || resolvedPhase === "local-editing") &&
          startEditAllowed
        ) {
          changeEditorMode(true, next, setMode);
          return;
        }
        if (
          verifiedCanEdit(note, meta) &&
          resolvedPhase === "server-preview" &&
          !isOfflineKnownSession(session)
        ) {
          setPendingEdit(true);
          setMode(next);
        }
      },
      session,
      setAccessDraft,
      setFolder,
      setHeader,
      setHistoryOpen,
      setNote,
      setSaveError,
      setShareOpen,
      viewMode,
    });
    return () => setHeader(null);
  }, [
    note,
    viewMode,
    startEditAllowed,
    awareness,
    folder,
    flags.isOwner,
    setHeader,
    resolvedPhase,
    session,
  ]);

  return (
    <EditorPageView
      accessDraft={accessDraft}
      loadError={loadError}
      note={note}
      onRetry={
        viewPhase === "load-error" || viewPhase === "uncached"
          ? triggerReload
          : undefined
      }
      viewPhase={resolvedPhase}
      workspace={
        note && accessDraft ? (
          <EditorWorkspace
            accessDraft={accessDraft}
            articleIssues={articleIssues}
            articleSource={articleSource}
            awareness={awareness}
            canEdit={startEditAllowed}
            collabBanner={collabBanner}
            collabBannerLive={collabBannerLive}
            headingTitle={headingTitle}
            historyOpen={historyOpen}
            isOwner={flags.isOwner}
            markdown={markdown}
            note={note}
            onCloseHistory={() => setHistoryOpen(false)}
            onCloseShare={() => setShareOpen(false)}
            onPersistAccess={(next) => {
              void persistEditorAccess(
                note,
                next,
                {
                  setAccessDraft,
                  setNote,
                  setSaveError,
                },
                mutationGuard,
              );
            }}
            onSplitScroll={(ratio) => {
              applySplitScroll(ratio, splitScrollLock, setSplitScroll);
            }}
            previewBanner={
              localSaveBanner
                ? [previewBanner, localSaveBanner].filter(Boolean).join(" · ")
                : previewBanner
            }
            ready={ready}
            saveError={saveError}
            shareOpen={shareOpen}
            splitScroll={splitScroll}
            taskNoteId={taskNoteId}
            user={user}
            usesInternalScroll={usesInternalScroll}
            viewMode={viewMode}
            viewPhase={resolvedPhase}
            yMarkdown={yMarkdown}
          />
        ) : null
      }
    />
  );
}

function bindEditorHeader(input: {
  note: Note | null;
  folder: string;
  viewMode: EditorMode;
  canEdit: boolean;
  headerVisible: boolean;
  serverMutationsVisible: boolean;
  awareness: NoteCollabSession["awareness"] | undefined;
  isOwner: boolean;
  session: import("../lib/offline-session.ts").SessionSnapshot;
  setHeader: AppShellContext["setHeader"];
  onRequestEdit: (mode: EditorMode) => void;
  setFolder: (folder: string) => void;
  setSaveError: (error: string | null) => void;
  setNote: (note: Note) => void;
  setAccessDraft: (draft: AccessDraft) => void;
  setShareOpen: (open: boolean) => void;
  setHistoryOpen: (open: boolean) => void;
}) {
  if (!input.note) {
    input.setHeader({ folder: null, layout: "editor" });
    return;
  }
  input.setHeader({
    actions: input.headerVisible ? (
      <EditorModeSwitch
        canEdit={input.canEdit || input.viewMode !== "preview"}
        onChange={input.onRequestEdit}
        value={input.viewMode}
      />
    ) : null,
    end: input.serverMutationsVisible ? (
      <EditorHeaderEnd
        awareness={input.awareness}
        folder={input.folder}
        folderId={input.note.folderId}
        isOwner={input.isOwner}
        onFolderBlur={() => {
          void persistEditorFolder(
            input.note,
            input.folder,
            normalizeFolder,
            {
              setAccessDraft: input.setAccessDraft,
              setFolder: input.setFolder,
              setNote: input.setNote,
              setSaveError: input.setSaveError,
            },
            () => input.serverMutationsVisible,
          );
        }}
        onFolderChange={input.setFolder}
        onHistory={() => input.setHistoryOpen(true)}
        onShare={() => input.setShareOpen(true)}
      />
    ) : (
      <FolderPopover
        folder={input.folder}
        folderId={input.note.folderId}
        isOwner={false}
        onFolderBlur={() => undefined}
        onFolderChange={() => undefined}
      />
    ),
    folder: input.folder,
    layout: "editor",
  });
}

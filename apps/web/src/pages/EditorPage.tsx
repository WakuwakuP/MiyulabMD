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
import { Link, useOutletContext, useParams } from "react-router";
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
  editorNeedsSession,
  editorViewModeFor,
  handleCollabAuthStop,
  isOfflineKnownSession,
  ownerLabelFor,
  persistEditorAccess,
  persistEditorFolder,
  resetEditorSnapshotForRoute,
  resolveEditorViewPhase,
  shouldRemoveSsrPreview,
  sourceLineNumbers,
  subscribeArticleSources,
  subscribeEditorNoteLoad,
  syncCollabUser,
  taskNoteIdFor,
  teardownCollab,
  verifiedCanEdit,
} from "./editor-page.ts";

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
  const editorCanEdit = canEdit && viewPhase === "editing";
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
      viewPhase === "load-error" ||
      viewPhase === "local-unsupported")
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
  snapshot: EditorNoteSnapshot,
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
  setters.setNote(snapshot.note);
  setters.setMarkdown(snapshot.markdown);
  setters.setFolder(snapshot.folder);
  setters.setAccessDraft(snapshot.accessDraft);
  setters.setLoadError(snapshot.loadError);
  setters.setPreviewBanner(snapshot.previewBanner);
  setters.setMeta(snapshot.meta);
  setters.setPendingEdit(snapshot.pendingEdit);
  setters.setViewPhase(snapshot.viewPhase);
}

export function EditorPage() {
  const { id = "" } = useParams();
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
  const awareness = collab?.awareness;
  const yMarkdown = collab?.yMarkdown;
  const ready = Boolean(yMarkdown && awareness && collabReady);
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
    loadGenerationRef.current = nextRequestGeneration();
    loadSessionEpochRef.current = session.sessionEpoch;
    setLoadTick((value) => value + 1);
  };

  useEffect(() => subscribeSession(setSession), []);

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
    loadGenerationRef.current = nextRequestGeneration();
    loadSessionEpochRef.current = session.sessionEpoch;
    applySnapshot(resetEditorSnapshotForRoute(id), snapshotSetters);
  }, [id, session.sessionEpoch]);

  useEffect(() => {
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
      sessionEpoch: loadSessionEpochRef.current,
    });
  }, [id, loadTick, session.sessionEpoch]);

  useEffect(() => {
    return subscribeOnlineStatus((online) => {
      if (online) {
        triggerReload();
      }
    });
  }, []);

  useEffect(() => {
    const onFocus = () => {
      triggerReload();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
    };
  }, []);

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
      snapshot: {
        accessDraft,
        folder,
        loadError,
        markdown,
        meta,
        note,
        pendingEdit,
        previewBanner,
        viewPhase: resolvedPhase,
      },
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
    bindEditorCollab({
      desiredConnection: editorDesiredConnection(resolvedPhase, collabReady),
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
  }, [noteId, userLoading, resolvedPhase, collabReady, hydrated, user]);

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
      headerVisible: editorHeaderMutationsVisible(
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
        if (resolvedPhase === "editing" && startEditAllowed) {
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
            previewBanner={previewBanner}
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
  const showMutations = input.headerVisible;
  input.setHeader({
    actions: showMutations ? (
      <EditorModeSwitch
        canEdit={input.canEdit || input.viewMode !== "preview"}
        onChange={input.onRequestEdit}
        value={input.viewMode}
      />
    ) : null,
    end: showMutations ? (
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
            () => showMutations,
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

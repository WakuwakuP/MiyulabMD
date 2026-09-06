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
import { MarkdownEditor } from "../components/editor/MarkdownEditor.tsx";
import { MarkdownPreview } from "../components/editor/MarkdownPreview.tsx";
import { PresenceBar } from "../components/editor/PresenceBar.tsx";
import { PreviewWithToc } from "../components/editor/PreviewWithToc.tsx";
import { RichMarkdownEditor } from "../components/editor/RichMarkdownEditor.tsx";
import type { AppShellContext } from "../components/layout/AppShellContext.ts";
import type { AccessDraft } from "../components/notes/AccessPanel.tsx";
import { ArticleFrontmatterAlert } from "../components/notes/ArticleFrontmatterAlert.tsx";
import { draftFromNote } from "../components/notes/access-draft.ts";
import { ShareModal } from "../components/notes/ShareModal.tsx";
import { HeaderButton } from "../components/ui/HeaderButton.tsx";
import { ShareIcon } from "../components/ui/icons.tsx";
import { editorLoadingClass } from "../components/ui/prose.ts";
import { ErrorText } from "../components/ui/Text.tsx";
import { cn } from "../lib/cn.ts";
import type { YjsSession } from "../lib/collaboration.ts";
import type { EditorMode } from "../lib/editor-mode.ts";
import {
  dismissStaleSsrPreview,
  removeSsrPreview,
} from "../lib/note-bootstrap.ts";
import { loadNote, noteFromCaches } from "../lib/note-cache.ts";
import {
  applyEditorNoteLoad,
  applySplitScroll,
  beginEditorNoteLoad,
  bindEditorCollab,
  changeEditorMode,
  editorGridClass,
  ownerLabelFor,
  persistEditorAccess,
  persistEditorFolder,
  sourceLineNumbers,
  subscribeArticleSources,
  syncCollabUser,
  teardownCollab,
} from "./editor-page.ts";

function EditorLoadError({ message }: { message: string }) {
  const showAuthLinks =
    message.includes("ログイン") || message.includes("権限");
  return (
    <section className="flex flex-col px-5 py-4">
      <ErrorText>{message}</ErrorText>
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
  yMarkdown: YjsSession["yMarkdown"] | undefined;
  awareness: YjsSession["awareness"] | undefined;
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
}: {
  viewMode: EditorMode;
  markdown: string;
  splitScroll: number;
  onSplitScroll: (ratio: number) => void;
}) {
  if (viewMode === "preview") {
    return <PreviewWithToc documentScroll={true} markdown={markdown} />;
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
  yMarkdown: YjsSession["yMarkdown"] | undefined;
  awareness: YjsSession["awareness"] | undefined;
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

function EditorWorkspace({
  note,
  markdown,
  accessDraft,
  saveError,
  articleSource,
  articleIssues,
  viewMode,
  usesInternalScroll,
  ready,
  yMarkdown,
  awareness,
  canEdit,
  splitScroll,
  shareOpen,
  headingTitle,
  user,
  isOwner,
  onSplitScroll,
  onPersistAccess,
  onCloseShare,
}: {
  note: Note;
  markdown: string;
  accessDraft: AccessDraft;
  saveError: string | null;
  articleSource: ArticleSource | null;
  articleIssues: ReturnType<typeof validateArticleDocument>["issues"];
  viewMode: EditorMode;
  usesInternalScroll: boolean;
  ready: boolean;
  yMarkdown: YjsSession["yMarkdown"] | undefined;
  awareness: YjsSession["awareness"] | undefined;
  canEdit: boolean;
  splitScroll: number;
  shareOpen: boolean;
  headingTitle: string;
  user: AppShellContext["user"];
  isOwner: boolean;
  onSplitScroll: (ratio: number) => void;
  onPersistAccess: (next: AccessDraft) => void;
  onCloseShare: () => void;
}) {
  const showSource = viewMode === "split" || viewMode === "source";
  const showPreview = viewMode === "split" || viewMode === "preview";
  const showRich = viewMode === "rich";
  return (
    <section
      className={cn("flex flex-col", usesInternalScroll && "h-full min-h-0")}
    >
      {saveError && <ErrorText className="px-5 py-4">{saveError}</ErrorText>}
      {articleSource && <ArticleFrontmatterAlert issues={articleIssues} />}
      <div className={editorGridClass(viewMode, usesInternalScroll, cn)}>
        {showSource && (
          <EditorSourcePane
            awareness={awareness}
            canEdit={canEdit}
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
            viewMode={viewMode}
          />
        )}
        {showRich && (
          <EditorRichPane
            awareness={awareness}
            canEdit={canEdit}
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
    </section>
  );
}

function EditorPageView({
  loading,
  loadError,
  note,
  accessDraft,
  workspace,
}: {
  loading: boolean;
  loadError: string | null;
  note: Note | null;
  accessDraft: AccessDraft | null;
  workspace: ReactNode;
}) {
  if (loading) {
    return (
      <section className="flex flex-col px-5 py-4">
        <p>読み込み中…</p>
      </section>
    );
  }
  if (loadError) {
    return <EditorLoadError message={loadError} />;
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
  onShare,
}: {
  awareness: YjsSession["awareness"] | undefined;
  folder: string;
  folderId: string | null;
  isOwner: boolean;
  onFolderChange: (folder: string) => void;
  onFolderBlur: () => void;
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

export function EditorPage() {
  const { id = "" } = useParams();
  const { user, userLoading, setHeader } = useOutletContext<AppShellContext>();
  const cached = noteFromCaches(id);
  const [note, setNote] = useState<Note | null>(() => cached ?? null);
  const [markdown, setMarkdown] = useState(() => cached?.markdown ?? "");
  const [folder, setFolder] = useState(() => cached?.folder ?? "");
  const [accessDraft, setAccessDraft] = useState<AccessDraft | null>(() =>
    cached ? draftFromNote(cached) : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !cached);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [collab, setCollab] = useState<YjsSession | null>(null);
  const [collabReady, setCollabReady] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [articleSources, setArticleSources] = useState<ArticleSource[]>([]);
  const [mode, setMode] = useState<EditorMode>("preview");
  const [splitScroll, setSplitScroll] = useState(0);
  const splitScrollLock = useRef(false);
  const hydratedRef = useRef(false);
  const sessionRef = useRef<YjsSession | null>(null);
  const unbindCollabRef = useRef<(() => void) | null>(null);

  const noteId = note?.id;
  const userId = user?.id;
  const flags = ownerFlags(user, note);
  const viewMode: EditorMode = flags.canEdit ? mode : "preview";
  const usesInternalScroll = viewMode !== "preview";
  const headingTitle = titleFromMarkdown(markdown);
  const articleSource = matchArticleSource(folder, articleSources);
  const articleIssues = articleIssuesFor(articleSource, markdown);
  const awareness = collab?.awareness;
  const yMarkdown = collab?.yMarkdown;
  const ready = Boolean(yMarkdown && awareness && collabReady);

  useEffect(() => {
    dismissStaleSsrPreview(id);
    const setters = {
      hydratedRef,
      setAccessDraft,
      setCollab,
      setCollabReady,
      setFolder,
      setLoadError,
      setLoading,
      setMarkdown,
      setMode,
      setNote,
      setSaveError,
      setSplitScroll,
    };
    const hit = beginEditorNoteLoad(id, setters);
    let cancelled = false;
    void loadNote(id, Boolean(hit)).then((result) => {
      applyEditorNoteLoad(result, id, hit, cancelled, setters);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => subscribeArticleSources(user, setArticleSources), [user]);

  useLayoutEffect(() => {
    dismissStaleSsrPreview(id);
    if (!loading && markdown) {
      removeSsrPreview();
    }
  }, [id, loading, markdown]);

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
    void noteId;
    void userId;
    return () => {
      teardownCollab(unbindCollabRef, sessionRef, setCollab, setCollabReady);
    };
  }, [noteId, userId]);

  useEffect(() => {
    bindEditorCollab({
      hydrated: hydratedRef.current,
      noteId,
      sessionRef,
      setCollab,
      setCollabReady,
      setMarkdown,
      unbindRef: unbindCollabRef,
      user,
      userLoading,
      viewMode,
    });
  }, [noteId, userLoading, viewMode, user]);

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
      canEdit: flags.canEdit,
      folder,
      isOwner: flags.isOwner,
      note,
      setAccessDraft,
      setFolder,
      setHeader,
      setMode,
      setNote,
      setSaveError,
      setShareOpen,
      viewMode,
    });
    return () => setHeader(null);
  }, [
    note,
    viewMode,
    flags.canEdit,
    awareness,
    folder,
    flags.isOwner,
    setHeader,
  ]);

  return (
    <EditorPageView
      accessDraft={accessDraft}
      loadError={loadError}
      loading={loading}
      note={note}
      workspace={
        note && accessDraft ? (
          <EditorWorkspace
            accessDraft={accessDraft}
            articleIssues={articleIssues}
            articleSource={articleSource}
            awareness={awareness}
            canEdit={flags.canEdit}
            headingTitle={headingTitle}
            isOwner={flags.isOwner}
            markdown={markdown}
            note={note}
            onCloseShare={() => setShareOpen(false)}
            onPersistAccess={(next) => {
              void persistEditorAccess(note, next, {
                setAccessDraft,
                setNote,
                setSaveError,
              });
            }}
            onSplitScroll={(ratio) => {
              applySplitScroll(ratio, splitScrollLock, setSplitScroll);
            }}
            ready={ready}
            saveError={saveError}
            shareOpen={shareOpen}
            splitScroll={splitScroll}
            user={user}
            usesInternalScroll={usesInternalScroll}
            viewMode={viewMode}
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
  awareness: YjsSession["awareness"] | undefined;
  isOwner: boolean;
  setHeader: AppShellContext["setHeader"];
  setMode: (mode: EditorMode) => void;
  setFolder: (folder: string) => void;
  setSaveError: (error: string | null) => void;
  setNote: (note: Note) => void;
  setAccessDraft: (draft: AccessDraft) => void;
  setShareOpen: (open: boolean) => void;
}) {
  if (!input.note) {
    input.setHeader({ folder: null, layout: "editor" });
    return;
  }
  input.setHeader({
    actions: (
      <EditorModeSwitch
        canEdit={input.canEdit}
        onChange={(next) =>
          changeEditorMode(input.canEdit, next, input.setMode)
        }
        value={input.viewMode}
      />
    ),
    end: (
      <EditorHeaderEnd
        awareness={input.awareness}
        folder={input.folder}
        folderId={input.note.folderId}
        isOwner={input.isOwner}
        onFolderBlur={() => {
          void persistEditorFolder(input.note, input.folder, normalizeFolder, {
            setAccessDraft: input.setAccessDraft,
            setFolder: input.setFolder,
            setNote: input.setNote,
            setSaveError: input.setSaveError,
          });
        }}
        onFolderChange={input.setFolder}
        onShare={() => input.setShareOpen(true)}
      />
    ),
    folder: input.folder,
    layout: "editor",
  });
}

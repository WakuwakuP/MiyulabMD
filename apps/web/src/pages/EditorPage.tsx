import type { Note } from "@miyulabmd/shared";
import { normalizeFolder, titleFromMarkdown } from "@miyulabmd/shared";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { ShareModal } from "../components/notes/ShareModal.tsx";
import { HeaderButton } from "../components/ui/HeaderButton.tsx";
import { ShareIcon } from "../components/ui/icons.tsx";
import { editorLoadingClass } from "../components/ui/prose.ts";
import { ErrorText } from "../components/ui/Text.tsx";
import { updateNote } from "../lib/api.ts";
import { cn } from "../lib/cn.ts";
import {
  applyAwarenessUser,
  createYjsSession,
  type YjsSession,
} from "../lib/collaboration.ts";
import { type EditorMode, writeEditorMode } from "../lib/editor-mode.ts";
import { loadOgCards } from "../lib/markdown.ts";
import {
  dismissStaleSsrPreview,
  removeSsrPreview,
} from "../lib/note-bootstrap.ts";
import { loadNote, noteFromCaches, seedNoteCache } from "../lib/note-cache.ts";

function draftFromNote(note: Note): AccessDraft {
  return {
    inherit: note.access.inherit,
    readScope: note.access.effectiveReadScope,
    writeScope: note.access.effectiveWriteScope,
    grants: note.access.grants,
  };
}

function applyLoadedNote(
  loaded: Note,
  setters: {
    setNote: (note: Note) => void;
    setMarkdown: (markdown: string) => void;
    setFolder: (folder: string) => void;
    setAccessDraft: (draft: AccessDraft) => void;
  },
) {
  setters.setNote(loaded);
  setters.setMarkdown(loaded.markdown);
  setters.setFolder(loaded.folder);
  setters.setAccessDraft(draftFromNote(loaded));
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
  const [mode, setMode] = useState<EditorMode>("preview");
  const [splitScroll, setSplitScroll] = useState(0);
  const splitScrollLock = useRef(false);

  const hydratedRef = useRef(false);

  useEffect(() => {
    dismissStaleSsrPreview(id);
    const hit = noteFromCaches(id);
    setLoadError(null);
    setSaveError(null);
    setCollab(null);
    setCollabReady(false);
    setMode("preview");
    setSplitScroll(0);

    if (hit) {
      applyLoadedNote(hit, {
        setNote,
        setMarkdown,
        setFolder,
        setAccessDraft,
      });
      hydratedRef.current = true;
      setLoading(false);
      void loadOgCards(hit.markdown);
    } else {
      hydratedRef.current = false;
      setLoading(true);
    }

    let cancelled = false;
    void loadNote(id, Boolean(hit)).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 401) {
          setLoadError("このノートを表示するにはログインが必要です。");
        } else if (result.status === 403) {
          setLoadError("このノートを表示する権限がありません。");
        } else if (result.status === 404) {
          setLoadError("ノートが見つかりません。");
        } else {
          setLoadError(result.error);
        }
        if (!noteFromCaches(id)) setNote(null);
        setLoading(false);
        return;
      }

      if (hit) {
        setNote(result.data);
        setFolder(result.data.folder);
        setAccessDraft(draftFromNote(result.data));
      } else {
        applyLoadedNote(result.data, {
          setNote,
          setMarkdown,
          setFolder,
          setAccessDraft,
        });
        hydratedRef.current = true;
      }
      setLoading(false);
      void loadOgCards(result.data.markdown);
    });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const noteId = note?.id;
  const userId = user?.id;
  const isOwner = Boolean(user && note && user.id === note.ownerId);
  const canEdit = Boolean(note?.access.flags.canEdit);
  const viewMode: EditorMode = canEdit ? mode : "preview";
  const usesInternalScroll = viewMode !== "preview";
  const sessionRef = useRef<YjsSession | null>(null);
  const unbindCollabRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    dismissStaleSsrPreview(id);
    if (!loading && markdown) removeSsrPreview();
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
    return () => {
      unbindCollabRef.current?.();
      unbindCollabRef.current = null;
      sessionRef.current?.destroy();
      sessionRef.current = null;
      setCollab(null);
      setCollabReady(false);
    };
  }, [noteId, userId]);

  useEffect(() => {
    if (!noteId || !hydratedRef.current || userLoading) return;
    if (viewMode === "preview") return;
    if (sessionRef.current) return;

    const session = createYjsSession(noteId, user);
    sessionRef.current = session;
    setCollab(session);
    setCollabReady(false);

    const onSynced = (synced: boolean) => {
      if (!synced) return;
      setCollabReady(true);
      const next = session.yMarkdown.toString();
      if (next.length > 0) setMarkdown(next);
    };

    if (session.provider.synced) {
      onSynced(true);
    } else {
      session.provider.on("sync", onSynced);
    }

    const onMarkdownChange = () => {
      setMarkdown(session.yMarkdown.toString());
    };
    session.yMarkdown.observe(onMarkdownChange);
    unbindCollabRef.current = () => {
      session.provider.off("sync", onSynced);
      session.yMarkdown.unobserve(onMarkdownChange);
    };
  }, [noteId, userLoading, viewMode, user]);

  useEffect(() => {
    if (!collab) return;
    collab.setUser(user);
    applyAwarenessUser(collab.awareness, user);
  }, [collab, user]);

  async function persistAccess(next: AccessDraft) {
    const currentNote = note;
    if (!currentNote) return;
    setAccessDraft(next);
    setSaveError(null);

    const result = await updateNote(currentNote.id, {
      inheritAccess: next.inherit,
      readScope: next.inherit ? null : next.readScope,
      writeScope: next.inherit ? null : next.writeScope,
      grants: next.grants.map((grant) => ({
        email: grant.email,
        canWrite: grant.canWrite,
      })),
    });
    if (!result.ok) {
      setSaveError(result.error);
      setAccessDraft(draftFromNote(currentNote));
      return;
    }
    setNote(result.data);
    setAccessDraft(draftFromNote(result.data));
    seedNoteCache(result.data);
  }

  async function handleFolderBlur() {
    const currentNote = note;
    if (!currentNote) return;
    const next = normalizeFolder(folder);
    if (next === currentNote.folder) return;

    const result = await updateNote(currentNote.id, { folder: next });
    if (!result.ok) {
      setFolder(currentNote.folder);
      setSaveError(result.error);
      return;
    }
    setNote(result.data);
    setFolder(result.data.folder);
    setAccessDraft(draftFromNote(result.data));
    seedNoteCache(result.data);
  }

  const headingTitle = titleFromMarkdown(markdown);

  function handleModeChange(next: EditorMode) {
    if (!canEdit && next !== "preview") return;
    setMode(next);
    writeEditorMode(next);
  }

  function handleSplitScroll(ratio: number) {
    if (splitScrollLock.current) return;
    splitScrollLock.current = true;
    setSplitScroll(ratio);
    window.requestAnimationFrame(() => {
      splitScrollLock.current = false;
    });
  }
  const awareness = collab?.awareness;
  const yMarkdown = collab?.yMarkdown;

  useEffect(() => {
    const previous = document.title;
    document.title = `${headingTitle} · MiyulabMD`;
    return () => {
      document.title = previous;
    };
  }, [headingTitle]);

  useEffect(() => {
    if (!note) {
      setHeader({ layout: "editor" });
      return () => setHeader(null);
    }

    setHeader({
      layout: "editor",
      actions: (
        <EditorModeSwitch
          value={viewMode}
          canEdit={canEdit}
          onChange={handleModeChange}
        />
      ),
      end: (
        <>
          {awareness && <PresenceBar awareness={awareness} />}
          <FolderPopover
            folder={folder}
            folderId={note.folderId}
            isOwner={isOwner}
            onFolderChange={setFolder}
            onFolderBlur={() => void handleFolderBlur()}
          />
          <HeaderButton
            variant="accent"
            icon={<ShareIcon />}
            label="共有"
            onClick={() => setShareOpen(true)}
          />
        </>
      ),
    });

    return () => setHeader(null);
  }, [note, viewMode, canEdit, awareness, folder, isOwner, setHeader]);

  if (loading) {
    return (
      <section className="flex flex-col px-5 py-4">
        <p>読み込み中…</p>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="flex flex-col px-5 py-4">
        <ErrorText>{loadError}</ErrorText>
        {(loadError.includes("ログイン") || loadError.includes("権限")) && (
          <p>
            <Link to="/">ホームに戻る</Link>
            {" · "}
            <a href="/auth/login">ログイン</a>
          </p>
        )}
      </section>
    );
  }

  if (!note || !accessDraft) {
    return null;
  }

  const ready = Boolean(yMarkdown && awareness && collabReady);
  const showSource = viewMode === "split" || viewMode === "source";
  const showPreview = viewMode === "split" || viewMode === "preview";
  const showRich = viewMode === "rich";

  const paneHeightClass = "h-full min-h-0";

  return (
    <section
      className={cn("flex flex-col", usesInternalScroll && paneHeightClass)}
    >
      {saveError && <ErrorText className="px-5 py-4">{saveError}</ErrorText>}
      <div
        className={cn(
          "grid min-h-0 flex-1 [&>*]:min-h-0",
          viewMode === "split" &&
            "grid-cols-2 max-[900px]:grid-cols-1 [&>:first-child]:border-r [&>:first-child]:border-border",
          viewMode !== "split" && "grid-cols-1",
          viewMode === "preview" && "block",
          usesInternalScroll && "overflow-hidden",
        )}
      >
        {showSource &&
          (ready && yMarkdown && awareness ? (
            <MarkdownEditor
              noteId={note.id}
              yText={yMarkdown}
              awareness={awareness}
              readOnly={!canEdit}
              lineNumbers={viewMode === "source" || viewMode === "split"}
              scrollRatio={viewMode === "split" ? splitScroll : undefined}
              onScrollRatio={
                viewMode === "split" ? handleSplitScroll : undefined
              }
            />
          ) : (
            <div className={editorLoadingClass}>
              <p>共同編集に接続中…</p>
            </div>
          ))}
        {showPreview &&
          (viewMode === "preview" ? (
            <PreviewWithToc markdown={markdown} documentScroll />
          ) : (
            <MarkdownPreview
              markdown={markdown}
              scrollRatio={splitScroll}
              onScrollRatio={handleSplitScroll}
            />
          ))}
        {showRich &&
          (ready && yMarkdown && awareness ? (
            <RichMarkdownEditor
              key={note.id}
              noteId={note.id}
              yText={yMarkdown}
              awareness={awareness}
              readOnly={!canEdit}
            />
          ) : (
            <div className={editorLoadingClass}>
              <p>共同編集に接続中…</p>
            </div>
          ))}
      </div>
      {shareOpen && (
        <ShareModal
          title={headingTitle}
          linkUrl={`${window.location.origin}/n/${note.id}`}
          ownerLabel={user?.displayName?.trim() || user?.email || "オーナー"}
          value={accessDraft}
          showInherit={isOwner}
          inheritLabel="ディレクトリの設定に従う"
          disabled={!isOwner}
          error={saveError}
          onChange={(next) => void persistAccess(next)}
          onClose={() => setShareOpen(false)}
        />
      )}
    </section>
  );
}

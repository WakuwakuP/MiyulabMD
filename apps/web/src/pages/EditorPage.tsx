import type { Note } from "@miyulabmd/shared";
import { normalizeFolder, titleFromMarkdown } from "@miyulabmd/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router";
import { EditorModeSwitch } from "../components/editor/EditorModeSwitch.tsx";
import { FolderPopover } from "../components/editor/FolderPopover.tsx";
import { MarkdownEditor } from "../components/editor/MarkdownEditor.tsx";
import { MarkdownPreview } from "../components/editor/MarkdownPreview.tsx";
import { PresenceBar } from "../components/editor/PresenceBar.tsx";
import { RichMarkdownEditor } from "../components/editor/RichMarkdownEditor.tsx";
import type { AppShellContext } from "../components/layout/AppShellContext.ts";
import type { AccessDraft } from "../components/notes/AccessPanel.tsx";
import { ShareModal } from "../components/notes/ShareModal.tsx";
import { HeaderButton } from "../components/ui/HeaderButton.tsx";
import { ShareIcon } from "../components/ui/icons.tsx";
import { editorLoadingClass } from "../components/ui/prose.ts";
import { ErrorText } from "../components/ui/Text.tsx";
import { cn } from "../lib/cn.ts";
import { fetchNote, updateNote } from "../lib/api.ts";
import { applyAwarenessUser, createYjsSession, type YjsSession } from "../lib/collaboration.ts";
import { writeEditorMode, type EditorMode } from "../lib/editor-mode.ts";

function draftFromNote(note: Note): AccessDraft {
  return {
    inherit: note.access.inherit,
    readScope: note.access.effectiveReadScope,
    writeScope: note.access.effectiveWriteScope,
    grants: note.access.grants,
  };
}

export function EditorPage() {
  const { id = "" } = useParams();
  const { user, userLoading, setHeader } = useOutletContext<AppShellContext>();
  const [note, setNote] = useState<Note | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [folder, setFolder] = useState("");
  const [accessDraft, setAccessDraft] = useState<AccessDraft | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [collab, setCollab] = useState<YjsSession | null>(null);
  const [collabReady, setCollabReady] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [mode, setMode] = useState<EditorMode>("preview");
  const [splitScroll, setSplitScroll] = useState(0);
  const splitScrollLock = useRef(false);

  const hydratedRef = useRef(false);

  useEffect(() => {
    hydratedRef.current = false;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setCollab(null);
    setCollabReady(false);
    setMode("preview");
    setSplitScroll(0);

    fetchNote(id).then((result) => {
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
        setNote(null);
        setLoading(false);
        return;
      }

      const loaded = result.data;
      setNote(loaded);
      setMarkdown(loaded.markdown);
      setFolder(loaded.folder);
      setAccessDraft(draftFromNote(loaded));
      hydratedRef.current = true;
      setLoading(false);
    });
  }, [id]);

  const noteId = note?.id;
  const userId = user?.id;

  useEffect(() => {
    if (!noteId || !hydratedRef.current || userLoading) return;

    const session = createYjsSession(noteId, user);
    setCollab(session);
    setCollabReady(false);

    const onSynced = (synced: boolean) => {
      if (!synced) return;
      setCollabReady(true);
      setMarkdown(session.yMarkdown.toString());
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

    return () => {
      session.provider.off("sync", onSynced);
      session.yMarkdown.unobserve(onMarkdownChange);
      session.destroy();
      setCollab(null);
      setCollabReady(false);
    };
  }, [noteId, userId, userLoading]);

  useEffect(() => {
    if (!collab) return;
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
      grants: next.grants.map((grant) => ({ email: grant.email, canWrite: grant.canWrite })),
    });
    if (!result.ok) {
      setSaveError(result.error);
      setAccessDraft(draftFromNote(currentNote));
      return;
    }
    setNote(result.data);
    setAccessDraft(draftFromNote(result.data));
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
  }

  const isOwner = Boolean(user && note && user.id === note.ownerId);
  const canEdit = Boolean(note?.access.flags.canEdit);
  const viewMode: EditorMode = canEdit ? mode : "preview";
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
      setHeader({ layout: "editor", title: "ノート" });
      return () => setHeader(null);
    }

    setHeader({
      layout: "editor",
      title: headingTitle,
      actions: <EditorModeSwitch value={viewMode} canEdit={canEdit} onChange={handleModeChange} />,
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
          <HeaderButton variant="accent" icon={<ShareIcon />} label="共有" onClick={() => setShareOpen(true)} />
        </>
      ),
    });

    return () => setHeader(null);
  }, [note, headingTitle, viewMode, canEdit, awareness, folder, isOwner, setHeader]);

  if (loading || userLoading) {
    return (
      <section className="flex min-h-[calc(100vh-5rem)] flex-col [[data-layout=editor]_&]:h-full [[data-layout=editor]_&]:min-h-0">
        <p>読み込み中…</p>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="flex min-h-[calc(100vh-5rem)] flex-col px-5 py-4 [[data-layout=editor]_&]:h-full [[data-layout=editor]_&]:min-h-0">
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

  return (
    <section className="flex min-h-[calc(100vh-5rem)] flex-col [[data-layout=editor]_&]:h-full [[data-layout=editor]_&]:min-h-0">
      {saveError && <ErrorText className="px-5 py-4">{saveError}</ErrorText>}
      <div
        className={cn(
          "grid min-h-0 flex-1 [&>*]:min-h-0",
          viewMode === "split" && "grid-cols-2 max-[900px]:grid-cols-1 [&>:first-child]:border-r [&>:first-child]:border-border",
          viewMode !== "split" && "grid-cols-1",
          viewMode === "preview" &&
            "[[data-layout=editor]_&]:block [[data-layout=editor]_&]:overflow-auto [[data-layout=editor]_&]:bg-preview",
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
              onScrollRatio={viewMode === "split" ? handleSplitScroll : undefined}
            />
          ) : (
            <div className={editorLoadingClass}>
              <p>共同編集に接続中…</p>
            </div>
          ))}
        {showPreview && (
          <MarkdownPreview
            className={
              viewMode === "preview"
                ? "[[data-layout=editor]_&]:mx-auto [[data-layout=editor]_&]:my-6 [[data-layout=editor]_&]:mb-12 [[data-layout=editor]_&]:h-auto [[data-layout=editor]_&]:min-h-[calc(100%-4.5rem)] [[data-layout=editor]_&]:w-[min(calc(100%-2rem),46rem)] [[data-layout=editor]_&]:rounded-[10px] [[data-layout=editor]_&]:border-0 [[data-layout=editor]_&]:bg-canvas [[data-layout=editor]_&]:px-10 [[data-layout=editor]_&]:pt-10 [[data-layout=editor]_&]:pb-16 [[data-layout=editor]_&]:shadow-preview"
                : undefined
            }
            markdown={markdown}
            scrollRatio={viewMode === "split" ? splitScroll : undefined}
            onScrollRatio={viewMode === "split" ? handleSplitScroll : undefined}
          />
        )}
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

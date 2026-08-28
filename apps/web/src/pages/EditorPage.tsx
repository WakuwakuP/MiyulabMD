import type { Note } from "@miyulabmd/shared";
import { folderUrl, normalizeFolder, titleFromMarkdown } from "@miyulabmd/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router";
import { EditorModeSwitch } from "../components/editor/EditorModeSwitch.tsx";
import { MarkdownEditor } from "../components/editor/MarkdownEditor.tsx";
import { MarkdownPreview } from "../components/editor/MarkdownPreview.tsx";
import { PresenceBar } from "../components/editor/PresenceBar.tsx";
import { RichMarkdownEditor } from "../components/editor/RichMarkdownEditor.tsx";
import type { AppShellContext } from "../components/layout/AppShellContext.ts";
import type { AccessDraft } from "../components/notes/AccessPanel.tsx";
import { ShareModal } from "../components/notes/ShareModal.tsx";
import { fetchNote, updateNote } from "../lib/api.ts";
import { applyAwarenessUser, createYjsSession, type YjsSession } from "../lib/collaboration.ts";
import { readEditorMode, writeEditorMode, type EditorMode } from "../lib/editor-mode.ts";

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
  const [mode, setMode] = useState<EditorMode>(() => readEditorMode());
  const [folderOpen, setFolderOpen] = useState(false);

  const hydratedRef = useRef(false);

  useEffect(() => {
    hydratedRef.current = false;
    setLoading(true);
    setLoadError(null);
    setSaveError(null);
    setCollab(null);
    setCollabReady(false);

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

  function handleModeChange(next: EditorMode) {
    setMode(next);
    writeEditorMode(next);
  }

  const isOwner = Boolean(user && note && user.id === note.ownerId);
  const canEdit = Boolean(note?.access.flags.canEdit);
  const headingTitle = titleFromMarkdown(markdown);
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
      actions: (
        <div className="header-editor-actions">
          <EditorModeSwitch value={mode} onChange={handleModeChange} />
          {awareness && <PresenceBar awareness={awareness} compact />}
          <div className="header-folder">
            <button type="button" onClick={() => setFolderOpen((value) => !value)}>
              フォルダ
            </button>
            {folderOpen && (
              <div className="header-folder-pop">
                {isOwner ? (
                  <>
                    <input
                      type="text"
                      value={folder}
                      onChange={(event) => setFolder(event.target.value)}
                      onBlur={() => void handleFolderBlur()}
                      placeholder="例: work/infra"
                      aria-label="ノートのフォルダ"
                    />
                    <Link to={folderUrl(note.folderId)}>開く</Link>
                  </>
                ) : note.folderId ? (
                  <Link to={folderUrl(note.folderId)}>フォルダを開く</Link>
                ) : (
                  <span>なし</span>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            className="header-share"
            onClick={() => {
              setFolderOpen(false);
              setShareOpen(true);
            }}
          >
            共有
          </button>
        </div>
      ),
    });

    return () => setHeader(null);
  }, [note, headingTitle, mode, awareness, folderOpen, folder, isOwner, setHeader]);

  if (loading || userLoading) {
    return (
      <section className="editor-page">
        <p>読み込み中…</p>
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="editor-page editor-page--padded">
        <p className="page-error">{loadError}</p>
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
  const showSource = mode === "split" || mode === "source";
  const showPreview = mode === "split" || mode === "preview";
  const showRich = mode === "rich";

  return (
    <section className="editor-page">
      {saveError && <p className="page-error editor-page-error">{saveError}</p>}
      <div className={`editor-workspace editor-workspace--${mode}`}>
        {showSource &&
          (ready && yMarkdown && awareness ? (
            <MarkdownEditor
              noteId={note.id}
              yText={yMarkdown}
              awareness={awareness}
              readOnly={!canEdit}
            />
          ) : (
            <div className="markdown-editor markdown-editor--loading">
              <p>共同編集に接続中…</p>
            </div>
          ))}
        {showPreview && <MarkdownPreview markdown={markdown} />}
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
            <div className="markdown-editor markdown-editor--loading">
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

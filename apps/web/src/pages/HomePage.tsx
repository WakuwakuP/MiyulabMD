import type { FolderAccess, Note, NoteSummary } from "@miyulabmd/shared";
import { folderUrl } from "@miyulabmd/shared";
import { type MouseEvent, useEffect, useState } from "react";
import { useNavigate, useOutletContext, useParams } from "react-router";
import type { AppShellContext } from "../components/layout/AppShellContext.ts";
import type { AccessDraft } from "../components/notes/AccessPanel.tsx";
import { ConfirmDialog } from "../components/notes/ConfirmDialog.tsx";
import {
  ContextMenu,
  type ContextMenuItem,
} from "../components/notes/ContextMenu.tsx";
import { FolderCreateModal } from "../components/notes/FolderCreateModal.tsx";
import { type MenuTarget, NoteTree } from "../components/notes/NoteTree.tsx";
import { ShareModal } from "../components/notes/ShareModal.tsx";
import { HeaderButton } from "../components/ui/HeaderButton.tsx";
import { FolderOutlineIcon, PlusIcon } from "../components/ui/icons.tsx";
import { ErrorText } from "../components/ui/Text.tsx";
import {
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  fetchFolder,
  fetchNote,
  fetchNotes,
  updateFolderAccess,
  updateNote,
} from "../lib/api.ts";

function draftFromFolder(access: FolderAccess): AccessDraft {
  return {
    inherit: access.inherit,
    readScope: access.effectiveReadScope,
    writeScope: access.effectiveWriteScope,
    grants: access.grants,
  };
}

function draftFromNote(note: Note): AccessDraft {
  return {
    inherit: note.access.inherit,
    readScope: note.access.effectiveReadScope,
    writeScope: note.access.effectiveWriteScope,
    grants: note.access.grants,
  };
}

type ShareState =
  | { kind: "folder"; folderId: string; name: string; draft: AccessDraft }
  | { kind: "note"; id: string; name: string; draft: AccessDraft };

type MenuState = {
  id: string;
  x: number;
  y: number;
  items: ContextMenuItem[];
};

type ConfirmState =
  | { kind: "folder"; id: string; name: string }
  | { kind: "note"; id: string; name: string };

export function HomePage() {
  const navigate = useNavigate();
  const { folderId } = useParams();
  const { user, setHeader } = useOutletContext<AppShellContext>();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [folder, setFolder] = useState<FolderAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<ShareState | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [folderCreateOpen, setFolderCreateOpen] = useState(false);
  const [folderCreating, setFolderCreating] = useState(false);
  const [folderCreateError, setFolderCreateError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      const noteList = await fetchNotes();
      if (cancelled) return;
      setNotes(noteList);

      if (!folderId && !user) {
        setFolder(null);
        setLoading(false);
        return;
      }

      const result = await fetchFolder(folderId);
      if (cancelled) return;
      if (!result.ok) {
        setFolder(null);
        setError(
          result.status === 404 ? "フォルダが見つかりません。" : result.error,
        );
        setLoading(false);
        return;
      }
      setFolder(result.data);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [folderId, user]);

  async function handleCreate() {
    setCreating(true);
    setError(null);

    const result = await createNote({
      markdown: "# 無題\n",
      folderId: folder?.id ?? undefined,
      folder: folder?.folder,
      inheritAccess: true,
    });
    if (!result.ok) {
      setError(
        result.status === 401
          ? "ノートを作成するにはログインが必要です。"
          : result.error,
      );
      setCreating(false);
      return;
    }

    navigate(`/n/${result.data.id}`);
  }

  async function persistNewFolder(name: string) {
    setFolderCreating(true);
    setFolderCreateError(null);

    const result = await createFolder({ name, parentId: folder?.id });
    if (!result.ok) {
      setFolderCreateError(result.error);
      setFolderCreating(false);
      return;
    }

    setFolderCreateOpen(false);
    setFolderCreating(false);
    if (result.data.id) {
      navigate(folderUrl(result.data.id));
      setShare({
        kind: "folder",
        folderId: result.data.id,
        name: result.data.name,
        draft: draftFromFolder(result.data),
      });
      setShareError(null);
    }
  }

  async function openFolderShare(id: string, name: string) {
    const result = await fetchFolder(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.data.locked || !result.data.id) {
      setError("ルートディレクトリの範囲は自分のみで固定です。");
      return;
    }
    setShare({
      kind: "folder",
      folderId: result.data.id,
      name,
      draft: draftFromFolder(result.data),
    });
    setShareError(null);
  }

  async function openNoteShare(note: NoteSummary) {
    const result = await fetchNote(note.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setShare({
      kind: "note",
      id: note.id,
      name: result.data.title,
      draft: draftFromNote(result.data),
    });
    setShareError(null);
  }

  async function persistShare(next: AccessDraft) {
    if (!share) return;
    setShare({ ...share, draft: next });
    setShareError(null);

    if (share.kind === "folder") {
      const result = await updateFolderAccess({
        folderId: share.folderId,
        inherit: next.inherit,
        readScope: next.inherit ? undefined : next.readScope,
        writeScope: next.inherit ? undefined : next.writeScope,
        grants: next.grants.map((grant) => ({
          email: grant.email,
          canWrite: grant.canWrite,
        })),
      });
      if (!result.ok) {
        setShareError(result.error);
        return;
      }
      setShare({ ...share, draft: draftFromFolder(result.data) });
      if (folder?.id === share.folderId) setFolder(result.data);
      return;
    }

    const result = await updateNote(share.id, {
      inheritAccess: next.inherit,
      readScope: next.inherit ? null : next.readScope,
      writeScope: next.inherit ? null : next.writeScope,
      grants: next.grants.map((grant) => ({
        email: grant.email,
        canWrite: grant.canWrite,
      })),
    });
    if (!result.ok) {
      setShareError(result.error);
      return;
    }
    setShare({
      ...share,
      name: result.data.title,
      draft: draftFromNote(result.data),
    });
  }

  function menuPosition(event: MouseEvent) {
    const target = event.currentTarget;
    if (target instanceof HTMLButtonElement) {
      const rect = target.getBoundingClientRect();
      return {
        x: Math.min(rect.right - 10, window.innerWidth - 180),
        y: rect.bottom + 4,
      };
    }
    return {
      x: Math.min(event.clientX, window.innerWidth - 180),
      y: Math.min(event.clientY, window.innerHeight - 160),
    };
  }

  function handleItemMenu(event: MouseEvent, target: MenuTarget) {
    const position = menuPosition(event);
    if (target.kind === "folder") {
      const items: ContextMenuItem[] = [
        { label: "開く", onSelect: () => navigate(folderUrl(target.id)) },
        {
          label: "共有",
          onSelect: () => void openFolderShare(target.id, target.name),
        },
      ];
      if (folder?.flags.canAdmin) {
        items.push({
          label: "削除",
          danger: true,
          onSelect: () => {
            setConfirm({ kind: "folder", id: target.id, name: target.name });
            setConfirmError(null);
          },
        });
      }
      setMenu({ id: target.id, ...position, items });
      return;
    }

    const items: ContextMenuItem[] = [
      { label: "開く", onSelect: () => navigate(`/n/${target.note.id}`) },
      { label: "共有", onSelect: () => void openNoteShare(target.note) },
    ];
    if (target.note.access.flags.canAdmin) {
      items.push({
        label: "削除",
        danger: true,
        onSelect: () => {
          setConfirm({
            kind: "note",
            id: target.note.id,
            name: target.note.title,
          });
          setConfirmError(null);
        },
      });
    }
    setMenu({ id: target.note.id, ...position, items });
  }

  async function refreshList() {
    const noteList = await fetchNotes();
    setNotes(noteList);
    if (!folderId) {
      if (!user) {
        setFolder(null);
        return;
      }
      const root = await fetchFolder();
      if (root.ok) setFolder(root.data);
      return;
    }
    const result = await fetchFolder(folderId);
    if (!result.ok) {
      setFolder(null);
      navigate("/");
      return;
    }
    setFolder(result.data);
  }

  async function persistDelete() {
    if (!confirm) return;
    setConfirmBusy(true);
    setConfirmError(null);
    const result =
      confirm.kind === "folder"
        ? await deleteFolder(confirm.id)
        : await deleteNote(confirm.id);
    if (!result.ok) {
      setConfirmError(result.error);
      setConfirmBusy(false);
      return;
    }
    setConfirm(null);
    setConfirmBusy(false);
    if (confirm.kind === "folder" && folderId === confirm.id) {
      navigate(folderUrl(folder?.parentId));
    }
    await refreshList();
  }

  const shareLink =
    share?.kind === "folder"
      ? `${window.location.origin}${folderUrl(share.folderId)}`
      : share
        ? `${window.location.origin}/n/${share.id}`
        : "";

  const canAdmin = Boolean(folder?.flags.canAdmin);
  const title = folderId ? (folder?.name ?? "フォルダ") : "ノート";

  useEffect(() => {
    setHeader({
      title,
      end:
        folder || !folderId ? (
          <>
            {canAdmin && (
              <HeaderButton
                variant="outline"
                icon={<FolderOutlineIcon />}
                label="フォルダ"
                onClick={() => {
                  setFolderCreateError(null);
                  setFolderCreateOpen(true);
                }}
              />
            )}
            <HeaderButton
              variant="accent"
              icon={<PlusIcon />}
              label={creating ? "作成中…" : "新規ノート"}
              disabled={creating}
              onClick={() => void handleCreate()}
            />
          </>
        ) : null,
    });
    return () => setHeader(null);
  }, [title, folder, folderId, canAdmin, creating, setHeader]);

  return (
    <section>
      {error && <ErrorText>{error}</ErrorText>}
      {loading ? (
        <p>読み込み中…</p>
      ) : folder || !folderId ? (
        <NoteTree
          notes={notes}
          currentFolderId={folder?.id ?? null}
          crumbs={folder?.crumbs ?? []}
          parentId={folder?.parentId ?? null}
          childrenFolders={folder?.children ?? []}
          showRootCrumb={canAdmin}
          openMenuId={menu?.id}
          onItemMenu={handleItemMenu}
        />
      ) : null}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menu.items}
          onClose={() => setMenu(null)}
        />
      )}
      {folderCreateOpen && (
        <FolderCreateModal
          busy={folderCreating}
          error={folderCreateError}
          onSubmit={(name) => void persistNewFolder(name)}
          onClose={() => {
            if (!folderCreating) setFolderCreateOpen(false);
          }}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.kind === "folder" ? "フォルダを削除" : "ノートを削除"}
          message={
            confirm.kind === "folder"
              ? `「${confirm.name}」を削除します。中のノートとフォルダも削除され、元に戻せません。`
              : `「${confirm.name}」を削除します。この操作は元に戻せません。`
          }
          busy={confirmBusy}
          error={confirmError}
          onConfirm={() => void persistDelete()}
          onClose={() => {
            if (!confirmBusy) setConfirm(null);
          }}
        />
      )}
      {share && user && (
        <ShareModal
          title={share.name}
          linkUrl={shareLink}
          ownerLabel={user.displayName?.trim() || user.email}
          value={share.draft}
          showInherit
          inheritLabel={
            share.kind === "folder"
              ? "親ディレクトリの設定に従う"
              : "ディレクトリの設定に従う"
          }
          error={shareError}
          onChange={(next) => void persistShare(next)}
          onClose={() => setShare(null)}
        />
      )}
    </section>
  );
}

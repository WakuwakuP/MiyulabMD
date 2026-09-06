import type { FolderAccess, NoteSummary } from "@miyulabmd/shared";
import { type MouseEvent, useCallback, useEffect, useState } from "react";
import {
  Link,
  useNavigate,
  useOutletContext,
  useSearchParams,
} from "react-router";
import type { AppShellContext } from "../components/layout/AppShellContext.ts";
import type { AccessDraft } from "../components/notes/AccessPanel.tsx";
import { AccessScopeMeta } from "../components/notes/AccessScopeMeta.tsx";
import { causeMessage } from "../components/notes/access-draft.ts";
import {
  ContextMenu,
  type ContextMenuItem,
} from "../components/notes/ContextMenu.tsx";
import { DrivePlaceNav } from "../components/notes/DrivePlaceNav.tsx";
import { ShareModal } from "../components/notes/ShareModal.tsx";
import { DriveList, DriveRow } from "../components/ui/DriveList.tsx";
import { FolderIcon, MarkdownIcon } from "../components/ui/icons.tsx";
import { ErrorText } from "../components/ui/Text.tsx";
import { prefetchNote } from "../lib/note-cache.ts";
import { sharedByMeItems } from "../lib/shared-by-me.ts";
import {
  loadSharedByMe,
  openSharedFolderShare,
  openSharedNoteShare,
  persistSharedShare,
  type ShareState,
  sharedInheritLabel,
  sharedShareLink,
} from "./shared-by-me-page.ts";

type MenuState = {
  id: string;
  x: number;
  y: number;
  items: ContextMenuItem[];
};

export function SharedByMePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const folderId = searchParams.get("folder");
  const sharedFolderUrl = (id: string | null) =>
    id ? `/shared-by-me?folder=${encodeURIComponent(id)}` : "/shared-by-me";
  const { user, userLoading, setHeader } = useOutletContext<AppShellContext>();
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [folders, setFolders] = useState<FolderAccess[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [share, setShare] = useState<ShareState | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    setHeader({
      actions: user ? <DrivePlaceNav current="shared-by-me" /> : null,
      folder: null,
    });
    return () => setHeader(null);
  }, [setHeader, user]);

  const loadData = useCallback(
    async (signal?: AbortSignal) => {
      await loadSharedByMe(user, signal, {
        setError,
        setFolders,
        setNotes,
        setPending,
      });
    },
    [user],
  );

  useEffect(() => {
    if (userLoading) {
      return;
    }
    if (!user) {
      navigate("/", { replace: true });
      return;
    }
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [user, userLoading, navigate, loadData]);

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

  function openFolderMenu(event: MouseEvent, folder: FolderAccess) {
    const folderId = folder.id;
    if (!folderId) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const position = menuPosition(event);
    const items: ContextMenuItem[] = [
      { label: "開く", onSelect: () => navigate(sharedFolderUrl(folder.id)) },
      { label: "共有設定", onSelect: () => void openFolderShare(folderId) },
    ];
    setMenu({ id: folderId, ...position, items });
  }

  function openNoteMenu(event: MouseEvent, note: NoteSummary) {
    event.preventDefault();
    event.stopPropagation();
    const position = menuPosition(event);
    const items: ContextMenuItem[] = [
      { label: "開く", onSelect: () => navigate(`/n/${note.id}`) },
      { label: "共有設定", onSelect: () => void openNoteShare(note.id) },
    ];
    setMenu({ id: note.id, ...position, items });
  }

  async function openFolderShare(folderId: string) {
    await openSharedFolderShare(
      folderId,
      user,
      setError,
      setShare,
      setShareError,
    );
  }

  async function openNoteShare(noteId: string) {
    await openSharedNoteShare(noteId, user, setError, setShare, setShareError);
  }

  async function persistShare(next: AccessDraft) {
    await persistSharedShare(share, next, {
      reload: () => loadData(),
      setShare,
      setShareError,
    });
  }

  const shareLink = sharedShareLink(share);

  const visible = sharedByMeItems(folders, notes, user?.id ?? "", folderId);
  const currentFolder = folders.find((folder) => folder.id === folderId);
  const empty = visible.folders.length === 0 && visible.notes.length === 0;
  if (!user) {
    return null;
  }

  return (
    <section>
      <p className="mb-3 text-sm text-muted">
        自分が共有しているアイテムです。各アイテムのメニューから共有設定を変更できます。
      </p>
      {folderId && (
        <nav
          aria-label="共有済みの階層"
          className="mb-3 flex flex-wrap items-center gap-2 text-sm"
        >
          <Link to="/shared-by-me">共有済み</Link>
          {currentFolder?.crumbs
            .filter((crumb) =>
              folders.some(
                (folder) => folder.id === crumb.id && !folder.locked,
              ),
            )
            .map((crumb) => (
              <span key={crumb.id}>
                {" / "}
                <Link to={sharedFolderUrl(crumb.id)}>{crumb.name}</Link>
              </span>
            ))}
        </nav>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {empty && !pending ? (
        <p>共有しているアイテムはありません。</p>
      ) : (
        <DriveList
          className={
            pending ? "opacity-60 transition-opacity duration-150" : undefined
          }
        >
          {visible.folders
            .slice()
            .sort((a, b) => a.name.localeCompare(b.name, "ja"))
            .map((folder) => (
              <DriveRow
                href={sharedFolderUrl(folder.id)}
                icon={<FolderIcon />}
                key={folder.id}
                menuOpen={menu?.id === folder.id}
                meta={
                  <AccessScopeMeta
                    readScope={folder.effectiveReadScope}
                    writeScope={folder.effectiveWriteScope}
                  />
                }
                name={folder.name}
                onMenu={(event) => openFolderMenu(event, folder)}
              />
            ))}
          {visible.notes
            .slice()
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((note) => (
              <DriveRow
                href={`/n/${note.id}`}
                icon={<MarkdownIcon />}
                key={note.id}
                menuOpen={menu?.id === note.id}
                meta={
                  <AccessScopeMeta
                    readScope={note.access.effectiveReadScope}
                    writeScope={note.access.effectiveWriteScope}
                  />
                }
                name={note.title}
                onMenu={(event) => openNoteMenu(event, note)}
                onPointerEnter={() => prefetchNote(note.id)}
              />
            ))}
        </DriveList>
      )}

      {menu && (
        <ContextMenu
          items={menu.items}
          onClose={() => setMenu(null)}
          x={menu.x}
          y={menu.y}
        />
      )}

      {share && (
        <ShareModal
          error={shareError}
          inheritLabel={sharedInheritLabel(share.kind)}
          linkUrl={shareLink}
          onChange={(next) => {
            void persistShare(next).catch((cause) => {
              setShareError(
                causeMessage(cause, "共有設定の更新に失敗しました。"),
              );
            });
          }}
          onClose={() => setShare(null)}
          ownerLabel={user.displayName?.trim() || user.email}
          showInherit={true}
          title={share.name}
          value={share.draft}
        />
      )}
    </section>
  );
}

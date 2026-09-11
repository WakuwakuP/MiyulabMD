import type {
  FolderAccess,
  FolderRecord,
  NoteSummary,
} from "@miyulabmd/shared";
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { useNavigate, useOutletContext, useParams } from "react-router";
import type { AppShellContext } from "../components/layout/AppShellContext.ts";
import type { AccessDraft } from "../components/notes/AccessPanel.tsx";
import { ConfirmDialog } from "../components/notes/ConfirmDialog.tsx";
import { ContextMenu } from "../components/notes/ContextMenu.tsx";
import { DrivePlaceNav } from "../components/notes/DrivePlaceNav.tsx";
import { FolderCreateModal } from "../components/notes/FolderCreateModal.tsx";
import { type MenuTarget, NoteTree } from "../components/notes/NoteTree.tsx";
import { ShareModal } from "../components/notes/ShareModal.tsx";
import { HeaderButton } from "../components/ui/HeaderButton.tsx";
import { FolderOutlineIcon, PlusIcon } from "../components/ui/icons.tsx";
import { ErrorText } from "../components/ui/Text.tsx";
import {
  getNotesLoadState,
  type NotesLoadState,
  peekFolder,
  peekNotes,
} from "../lib/list-cache.ts";
import { canCreateLocalDraft } from "../lib/home-draft-list.ts";
import {
  getSessionSnapshot,
  subscribeSession,
} from "../lib/offline-session.ts";
import {
  type ConfirmState,
  confirmCopy,
  handleItemMenu,
  headerFolderFor,
  homeListFlags,
  homeOfflineCreateMessage,
  homeRemoteMutationsBlocked,
  inheritLabelFor,
  type MenuState,
  openFolderShare,
  openNoteShare,
  persistHomeDelete,
  persistHomeShare,
  persistNewFolder,
  persistNewNote,
  persistRenameFolder,
  type ShareState,
  shareLinkFor,
  subscribeHomeFolder,
  subscribeHomeNotes,
} from "./home-page.ts";

function HomeHeaderEnd({
  canAdmin,
  creating,
  showEnd,
  remoteBlocked,
  createBlocked,
  onCreateFolder,
  onCreateNote,
}: {
  canAdmin: boolean;
  creating: boolean;
  showEnd: boolean;
  remoteBlocked: boolean;
  createBlocked: boolean;
  onCreateFolder: () => void;
  onCreateNote: () => void;
}) {
  if (!showEnd) {
    return null;
  }
  return (
    <>
      {canAdmin && (
        <HeaderButton
          disabled={remoteBlocked}
          icon={<FolderOutlineIcon />}
          label="フォルダ"
          onClick={onCreateFolder}
          title={
            remoteBlocked
              ? "オフラインではフォルダを作成できません。"
              : undefined
          }
          variant="outline"
        />
      )}
      <HeaderButton
        disabled={creating || createBlocked}
        icon={<PlusIcon />}
        label={creating ? "作成中…" : "新規ノート"}
        onClick={onCreateNote}
        title={createBlocked ? homeOfflineCreateMessage() : undefined}
        variant="accent"
      />
    </>
  );
}

function useHomeHeader(
  headerFolder: string | null | undefined,
  user: AppShellContext["user"],
  folderId: string | undefined,
  visibleFolder: FolderAccess | null,
  canAdmin: boolean,
  creating: boolean,
  remoteBlocked: boolean,
  createBlocked: boolean,
  setHeader: AppShellContext["setHeader"],
  onCreateFolder: () => void,
  onCreateNote: () => void,
) {
  useEffect(() => {
    setHeader({
      actions: user ? (
        <DrivePlaceNav current={canAdmin || !folderId ? "drive" : "shared"} />
      ) : null,
      end: (
        <HomeHeaderEnd
          canAdmin={canAdmin}
          createBlocked={createBlocked}
          creating={creating}
          onCreateFolder={onCreateFolder}
          onCreateNote={onCreateNote}
          remoteBlocked={remoteBlocked}
          showEnd={Boolean(visibleFolder || !folderId)}
        />
      ),
      folder: headerFolder,
    });
    return () => setHeader(null);
  }, [
    headerFolder,
    visibleFolder,
    folderId,
    canAdmin,
    creating,
    remoteBlocked,
    createBlocked,
    setHeader,
    user,
    onCreateFolder,
    onCreateNote,
  ]);
}

function HomePageDialogs({
  user,
  menu,
  folderCreateOpen,
  folderCreating,
  folderCreateError,
  folderRename,
  folderRenaming,
  folderRenameError,
  confirm,
  confirmBusy,
  confirmError,
  share,
  shareError,
  shareLink,
  onCloseMenu,
  onCreateFolder,
  onCloseCreateFolder,
  onRenameFolder,
  onCloseRename,
  onConfirmDelete,
  onCloseConfirm,
  onPersistShare,
  onCloseShare,
}: {
  user: AppShellContext["user"];
  menu: MenuState | null;
  folderCreateOpen: boolean;
  folderCreating: boolean;
  folderCreateError: string | null;
  folderRename: { id: string; name: string } | null;
  folderRenaming: boolean;
  folderRenameError: string | null;
  confirm: ConfirmState | null;
  confirmBusy: boolean;
  confirmError: string | null;
  share: ShareState | null;
  shareError: string | null;
  shareLink: string;
  onCloseMenu: () => void;
  onCreateFolder: (name: string) => void;
  onCloseCreateFolder: () => void;
  onRenameFolder: (name: string) => void;
  onCloseRename: () => void;
  onConfirmDelete: () => void;
  onCloseConfirm: () => void;
  onPersistShare: (next: AccessDraft) => void;
  onCloseShare: () => void;
}) {
  const copy = confirm ? confirmCopy(confirm) : null;
  return (
    <>
      {menu && (
        <ContextMenu
          items={menu.items}
          onClose={onCloseMenu}
          x={menu.x}
          y={menu.y}
        />
      )}
      {folderCreateOpen && (
        <FolderCreateModal
          busy={folderCreating}
          error={folderCreateError}
          onClose={onCloseCreateFolder}
          onSubmit={onCreateFolder}
        />
      )}
      {folderRename && (
        <FolderCreateModal
          busy={folderRenaming}
          busyLabel="変更中…"
          error={folderRenameError}
          initialName={folderRename.name}
          onClose={onCloseRename}
          onSubmit={onRenameFolder}
          submitLabel="変更"
          title="フォルダ名を変更"
        />
      )}
      {confirm && copy && (
        <ConfirmDialog
          busy={confirmBusy}
          error={confirmError}
          message={copy.message}
          onClose={onCloseConfirm}
          onConfirm={onConfirmDelete}
          title={copy.title}
        />
      )}
      {share && user && (
        <ShareModal
          error={shareError}
          inheritLabel={inheritLabelFor(share.kind)}
          linkUrl={shareLink}
          onChange={onPersistShare}
          onClose={onCloseShare}
          ownerLabel={user.displayName?.trim() || user.email}
          showInherit={true}
          title={share.name}
          value={share.draft}
        />
      )}
    </>
  );
}

function HomePageView({
  user,
  folderId,
  userLoading,
  notes,
  notesError,
  visibleFolder,
  publicFolders,
  error,
  flags,
  menu,
  onItemMenu,
  dialogs,
}: {
  user: AppShellContext["user"];
  folderId: string | undefined;
  userLoading: boolean;
  notes: NoteSummary[];
  visibleFolder: FolderAccess | null;
  publicFolders: FolderRecord[];
  error: string | null;
  flags: ReturnType<typeof homeListFlags>;
  notesError: boolean;
  menu: MenuState | null;
  onItemMenu: (event: MouseEvent, target: MenuTarget) => void;
  dialogs: ReactNode;
}) {
  const showGuestTitle = !(user || folderId || userLoading);
  return (
    <section>
      {showGuestTitle && (
        <h1 className="mb-3 text-lg font-semibold">全体公開</h1>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {notesError && <ErrorText>一覧を取得できませんでした。</ErrorText>}
      {flags.showTree ? (
        <NoteTree
          childrenFolders={
            user || folderId ? (visibleFolder?.children ?? []) : publicFolders
          }
          crumbs={visibleFolder?.crumbs ?? []}
          currentFolderId={visibleFolder?.id ?? null}
          isDriveRoot={flags.isDriveRoot}
          notes={notes}
          onItemMenu={onItemMenu}
          openMenuId={menu?.id}
          parentId={visibleFolder?.parentId ?? null}
          pending={flags.listPending}
          placeholder={flags.showPlaceholder}
          rootHref={user ? "/shared" : "/"}
          showAllNotes={!(user || folderId)}
          showEmptyMessage={flags.showEmptyList}
          showRootCrumb={flags.canAdmin}
        />
      ) : null}
      {dialogs}
    </section>
  );
}

export function HomePage() {
  const navigate = useNavigate();
  const { folderId } = useParams();
  const { user, userLoading, setHeader } = useOutletContext<AppShellContext>();
  const [session, setSession] = useState(getSessionSnapshot);
  const remoteBlocked = homeRemoteMutationsBlocked(session);
  const createBlocked = !canCreateLocalDraft(session, user);
  const [notes, setNotes] = useState<NoteSummary[]>(() => peekNotes() ?? []);
  const [notesLoadState, setNotesLoadState] = useState<NotesLoadState>(() =>
    getNotesLoadState(),
  );
  const [notesError, setNotesError] = useState(false);
  const [visibleFolder, setVisibleFolder] = useState<FolderAccess | null>(
    () => peekFolder(folderId) ?? null,
  );
  const [folderPending, setFolderPending] = useState(
    () => !peekFolder(folderId),
  );
  const [publicFolders, setPublicFolders] = useState<FolderRecord[]>([]);
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
  const [folderRename, setFolderRename] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [folderRenaming, setFolderRenaming] = useState(false);
  const [folderRenameError, setFolderRenameError] = useState<string | null>(
    null,
  );

  const sessionKey = user?.id ?? "guest";
  const flags = homeListFlags({
    error,
    folderId,
    folderPending,
    notesError,
    notesLoadState,
    user,
    userLoading,
    visibleFolder,
  });
  const headerFolder = headerFolderFor(visibleFolder, folderId);
  const shareLink = shareLinkFor(share);

  useEffect(() => subscribeSession(setSession), []);

  useEffect(() => {
    if (!remoteBlocked) {
      return;
    }
    setShare(null);
    setConfirm(null);
    setFolderCreateOpen(false);
    setFolderRename(null);
    setMenu(null);
  }, [remoteBlocked]);

  useEffect(() => {
    void sessionKey;
    return subscribeHomeNotes(
      userLoading,
      user,
      visibleFolder?.id ?? null,
      setNotes,
      setNotesLoadState,
      setNotesError,
    );
  }, [sessionKey, userLoading, user, visibleFolder?.id]);

  useEffect(() => {
    return subscribeHomeFolder(folderId, user, userLoading, {
      setError,
      setFolderPending,
      setPublicFolders,
      setVisibleFolder,
    });
  }, [folderId, user, userLoading]);

  // Header updates re-render AppShell and this page. Keep its callbacks stable
  // so useHomeHeader does not publish another header on every parent render.
  const handleCreateFolder = useCallback(() => {
    setFolderCreateError(null);
    setFolderCreateOpen(true);
  }, []);
  const handleCreateNote = useCallback(() => {
    void persistNewNote(
      visibleFolder,
      navigate,
      setCreating,
      setError,
      user,
      session,
    );
  }, [visibleFolder, navigate, user, session]);

  useHomeHeader(
    headerFolder,
    user,
    folderId,
    visibleFolder,
    flags.canAdmin,
    creating,
    remoteBlocked,
    createBlocked,
    setHeader,
    handleCreateFolder,
    handleCreateNote,
  );

  return (
    <HomePageView
      dialogs={
        <HomePageDialogs
          confirm={confirm}
          confirmBusy={confirmBusy}
          confirmError={confirmError}
          folderCreateError={folderCreateError}
          folderCreateOpen={folderCreateOpen}
          folderCreating={folderCreating}
          folderRename={folderRename}
          folderRenameError={folderRenameError}
          folderRenaming={folderRenaming}
          menu={menu}
          onCloseConfirm={() => {
            if (!confirmBusy) {
              setConfirm(null);
            }
          }}
          onCloseCreateFolder={() => {
            if (!folderCreating) {
              setFolderCreateOpen(false);
            }
          }}
          onCloseMenu={() => setMenu(null)}
          onCloseRename={() => {
            if (!folderRenaming) {
              setFolderRename(null);
            }
          }}
          onCloseShare={() => setShare(null)}
          onConfirmDelete={() => {
            void persistHomeDelete(
              confirm,
              folderId,
              visibleFolder?.parentId,
              user,
              navigate,
              {
                setConfirm,
                setConfirmBusy,
                setConfirmError,
                setNotes,
                setVisibleFolder,
              },
              remoteBlocked,
              undefined,
            );
          }}
          onCreateFolder={(name) => {
            void persistNewFolder(
              name,
              visibleFolder,
              navigate,
              {
                setFolderCreateError,
                setFolderCreateOpen,
                setFolderCreating,
                setShare,
                setShareError,
              },
              remoteBlocked,
            );
          }}
          onPersistShare={(next) => {
            void persistHomeShare(
              share,
              next,
              visibleFolder?.id,
              {
                setNotes,
                setShare,
                setShareError,
                setVisibleFolder,
              },
              remoteBlocked,
            );
          }}
          onRenameFolder={(name) => {
            void persistRenameFolder(
              folderRename,
              name,
              visibleFolder?.id,
              folderId,
              user,
              navigate,
              {
                setFolderRename,
                setFolderRenameError,
                setFolderRenaming,
                setNotes,
                setVisibleFolder,
              },
              remoteBlocked,
            );
          }}
          share={share}
          shareError={shareError}
          shareLink={shareLink}
          user={user}
        />
      }
      error={error}
      flags={flags}
      folderId={folderId}
      menu={menu}
      notes={notes}
      notesError={notesError}
      onItemMenu={(event, target) => {
        handleItemMenu(
          event,
          target,
          flags.canAdmin,
          navigate,
          setMenu,
          (id, name) => {
            void openFolderShare(
              id,
              name,
              setError,
              setShare,
              setShareError,
              remoteBlocked,
            );
          },
          (note) => {
            void openNoteShare(
              note,
              setError,
              setShare,
              setShareError,
              remoteBlocked,
            );
          },
          (id, name) => {
            setFolderRename({ id, name });
            setFolderRenameError(null);
          },
          (kind, id, name) => {
            setConfirm({ id, kind, name });
            setConfirmError(null);
          },
          remoteBlocked,
        );
      }}
      publicFolders={publicFolders}
      user={user}
      userLoading={userLoading}
      visibleFolder={visibleFolder}
    />
  );
}

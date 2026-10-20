import type {
  FolderAccess,
  FolderRecord,
  MedallionAssignment,
  MedallionSet,
  NoteSummary,
  ParaSpaceSummary,
  SchemeSuggestion,
} from "@miyulabmd/shared";
import {
  medalForLayerKey,
  resolveMedallionAssignment,
} from "@miyulabmd/shared";
import { UsersRound } from "lucide-react";
import {
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useOutletContext, useParams } from "react-router";
import type { AppShellContext } from "../components/layout/AppShellContext.ts";
import type { AccessDraft } from "../components/notes/AccessPanel.tsx";
import { ConfirmDialog } from "../components/notes/ConfirmDialog.tsx";
import { ContextMenu } from "../components/notes/ContextMenu.tsx";
import { DriveMembersDialog } from "../components/notes/DriveMembersDialog.tsx";
import { DriveMoveDialog } from "../components/notes/DriveMoveDialog.tsx";
import {
  DrivePlaceNav,
  type DriveSelection,
} from "../components/notes/DrivePlaceNav.tsx";
import { FolderCreateModal } from "../components/notes/FolderCreateModal.tsx";
import { MedallionDialog } from "../components/notes/MedallionDialog.tsx";
import { type MenuTarget, NoteTree } from "../components/notes/NoteTree.tsx";
import { SchemeDialog } from "../components/notes/SchemeDialog.tsx";
import { ShareModal } from "../components/notes/ShareModal.tsx";
import { HeaderButton } from "../components/ui/HeaderButton.tsx";
import { IconButton } from "../components/ui/IconButton.tsx";
import {
  FolderOutlineIcon,
  MoreIcon,
  PlusIcon,
} from "../components/ui/icons.tsx";
import { MenuItem, MenuPanel } from "../components/ui/Menu.tsx";
import { ErrorText } from "../components/ui/Text.tsx";
import { useDismiss } from "../hooks/use-dismiss.ts";
import {
  archiveParaProject,
  fetchFolderChildren,
  fetchMedallionAssignments,
  fetchMedallionSets,
  fetchSchemeSuggestion,
  fetchSharedDrive,
  moveFolder,
  moveNotes,
} from "../lib/api.ts";
import type { TreeDragItem } from "../lib/dnd.ts";
import {
  HomeMetadataError,
  readHomeMetadata,
} from "../lib/home-metadata-reader.ts";
import { useKnowledgeFeature } from "../lib/knowledge-features.ts";
import {
  invalidateFolderCache,
  invalidateNotesCache,
} from "../lib/list-cache.ts";
import {
  readOfflineFolderDenial,
  readOfflineNoteDenial,
  subscribeOfflineCacheFolderDenial,
  subscribeOfflineCacheNoteDenial,
} from "../lib/offline-cache.ts";
import { CachedDriveView } from "./CachedDriveView.tsx";
import {
  type ConfirmState,
  confirmCopy,
  handleItemMenu,
  headerFolderFor,
  homeListFlags,
  inheritLabelFor,
  loadParaSpaces,
  type MedallionDialogTarget,
  type MenuState,
  type MoveTarget,
  openFolderShare,
  openNoteShare,
  persistFolderMedallion,
  persistFolderScheme,
  persistHomeDelete,
  persistHomeShare,
  persistNewFolder,
  persistNewNote,
  persistRenameFolder,
  type ShareState,
  shareLinkFor,
} from "./home-page.ts";

function HomeHeaderEnd({
  canCreateFolder,
  canCreateNote,
  creating,
  membersOnly,
  showEnd,
  onCreateFolder,
  onCreateNote,
  onMembers,
}: {
  canCreateFolder: boolean;
  canCreateNote: boolean;
  creating: boolean;
  membersOnly: boolean;
  showEnd: boolean;
  onCreateFolder: () => void;
  onCreateNote: () => void;
  onMembers: () => void;
}) {
  if (!showEnd) {
    return null;
  }
  const hasActions = membersOnly || canCreateFolder || canCreateNote;
  return (
    <>
      <div className="flex items-center gap-2 max-[900px]:hidden">
        {membersOnly && (
          <HeaderButton
            icon={<UsersRound aria-hidden={true} className="size-4" />}
            label="メンバー"
            onClick={onMembers}
            variant="outline"
          />
        )}
        {canCreateFolder && (
          <HeaderButton
            icon={<FolderOutlineIcon />}
            label="フォルダ"
            onClick={onCreateFolder}
            variant="outline"
          />
        )}
        {canCreateNote && (
          <HeaderButton
            disabled={creating}
            icon={<PlusIcon />}
            label={creating ? "作成中…" : "新規ノート"}
            onClick={onCreateNote}
            variant="accent"
          />
        )}
      </div>
      {hasActions && (
        <HomeHeaderMenu
          canCreateFolder={canCreateFolder}
          canCreateNote={canCreateNote}
          creating={creating}
          membersOnly={membersOnly}
          onCreateFolder={onCreateFolder}
          onCreateNote={onCreateNote}
          onMembers={onMembers}
        />
      )}
    </>
  );
}

function HomeHeaderMenu({
  canCreateFolder,
  canCreateNote,
  creating,
  membersOnly,
  onCreateFolder,
  onCreateNote,
  onMembers,
}: {
  canCreateFolder: boolean;
  canCreateNote: boolean;
  creating: boolean;
  membersOnly: boolean;
  onCreateFolder: () => void;
  onCreateNote: () => void;
  onMembers: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  useDismiss(open, () => setOpen(false), rootRef);

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div className="relative min-[900px]:hidden" ref={rootRef}>
      <IconButton
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="操作メニュー"
        onClick={() => setOpen((value) => !value)}
        title="操作"
        variant="ghost"
      >
        <MoreIcon />
      </IconButton>
      {open && (
        <MenuPanel>
          {membersOnly && (
            <MenuItem onClick={() => choose(onMembers)}>
              <span className="flex items-center gap-2">
                <UsersRound aria-hidden={true} className="size-4" />
                メンバー
              </span>
            </MenuItem>
          )}
          {canCreateFolder && (
            <MenuItem onClick={() => choose(onCreateFolder)}>
              <span className="flex items-center gap-2">
                <FolderOutlineIcon />
                フォルダ
              </span>
            </MenuItem>
          )}
          {canCreateNote && (
            <MenuItem disabled={creating} onClick={() => choose(onCreateNote)}>
              <span className="flex items-center gap-2">
                <PlusIcon />
                {creating ? "作成中…" : "新規ノート"}
              </span>
            </MenuItem>
          )}
        </MenuPanel>
      )}
    </div>
  );
}

function useHomeHeader(
  headerFolder: string | null | undefined,
  user: AppShellContext["user"],
  folderId: string | undefined,
  visibleFolder: FolderAccess | null,
  folderPending: boolean,
  selection: DriveSelection,
  canCreateFolder: boolean,
  canCreateNote: boolean,
  membersOnly: boolean,
  creating: boolean,
  setHeader: AppShellContext["setHeader"],
  onCreateFolder: () => void,
  onCreateNote: () => void,
  onMembers: () => void,
) {
  useEffect(() => {
    setHeader({
      actions: user ? <DrivePlaceNav selection={selection} /> : null,
      end: (
        <HomeHeaderEnd
          canCreateFolder={canCreateFolder}
          canCreateNote={canCreateNote}
          creating={creating}
          membersOnly={membersOnly}
          onCreateFolder={onCreateFolder}
          onCreateNote={onCreateNote}
          onMembers={onMembers}
          showEnd={Boolean(
            visibleFolder || !(folderId || user || folderPending),
          )}
        />
      ),
      folder: headerFolder,
      folderId: visibleFolder?.id ?? null,
    });
    return () => setHeader(null);
  }, [
    headerFolder,
    visibleFolder,
    folderPending,
    folderId,
    selection,
    canCreateFolder,
    canCreateNote,
    membersOnly,
    creating,
    setHeader,
    user,
    onCreateFolder,
    onCreateNote,
    onMembers,
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
  schemeDialog,
  schemeBusy,
  schemeError,
  schemeSuggestion,
  medallionAssignments,
  medallionDialog,
  medallionBusy,
  medallionError,
  medallionSets,
  share,
  shareError,
  shareLink,
  onCloseMedallion,
  onCloseMenu,
  onPersistMedallion,
  onCreateFolder,
  onCloseCreateFolder,
  onRenameFolder,
  onCloseRename,
  onConfirmDelete,
  onCloseConfirm,
  onPersistScheme,
  onCloseScheme,
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
  schemeDialog: { id: string; name: string; scheme: string | null } | null;
  schemeBusy: boolean;
  schemeError: string | null;
  schemeSuggestion: SchemeSuggestion | null;
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
  onPersistScheme: (scheme: string | null) => void;
  onCloseScheme: () => void;
  medallionAssignments: MedallionAssignment[];
  medallionDialog: MedallionDialogTarget | null;
  medallionBusy: boolean;
  medallionError: string | null;
  medallionSets: MedallionSet[];
  onCloseMedallion: () => void;
  onPersistMedallion: (next: { setId: string; layer: string } | null) => void;
  onPersistShare: (next: AccessDraft) => void;
  onCloseShare: () => void;
}) {
  const copy = confirm ? confirmCopy(confirm) : null;
  const medallionCurrent = medallionDialog
    ? (medallionAssignments.find(
        (assignment) => assignment.folderId === medallionDialog.id,
      ) ?? null)
    : null;
  // Inherited = nearest assignment above this folder's own path.
  const medallionParentPath = medallionDialog?.path
    ?.split("/")
    .slice(0, -1)
    .join("/");
  const medallionInherited =
    medallionDialog && !medallionCurrent && medallionParentPath !== undefined
      ? resolveMedallionAssignment(medallionAssignments, medallionParentPath)
      : null;
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
          suggestion={schemeSuggestion}
        />
      )}
      {medallionDialog && (
        <MedallionDialog
          busy={medallionBusy}
          current={
            medallionCurrent
              ? {
                  layerKey: medallionCurrent.layerKey,
                  setId: medallionCurrent.setId,
                }
              : null
          }
          error={medallionError}
          folderName={medallionDialog.name}
          inherited={
            medallionInherited
              ? {
                  assignedPath: medallionInherited.path,
                  layerLabel: medallionInherited.layerLabel,
                }
              : null
          }
          onClear={() => onPersistMedallion(null)}
          onClose={onCloseMedallion}
          onSubmit={(setId, layer) => onPersistMedallion({ layer, setId })}
          sets={medallionSets}
        />
      )}
      {schemeDialog && (
        <SchemeDialog
          busy={schemeBusy}
          current={schemeDialog.scheme}
          error={schemeError}
          folderName={schemeDialog.name}
          onClose={onCloseScheme}
          onSubmit={onPersistScheme}
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

const EMPTY_CHILDREN: FolderRecord[] = [];
const EMPTY_PARA: ParaSpaceSummary[] = [];

function HomePageView({
  user,
  folderId,
  userLoading,
  notes,
  visibleFolder,
  publicFolders,
  error,
  cacheWarning,
  flags,
  menu,
  medallionForPath,
  onItemMenu,
  onMove,
  paraSpaces,
  dialogs,
}: {
  user: AppShellContext["user"];
  folderId: string | undefined;
  userLoading: boolean;
  notes: NoteSummary[];
  visibleFolder: FolderAccess | null;
  publicFolders: FolderRecord[];
  error: string | null;
  cacheWarning: string | null;
  flags: ReturnType<typeof homeListFlags>;
  menu: MenuState | null;
  medallionForPath?: (
    path: string | undefined,
  ) => { medal: string; label: string } | null;
  onItemMenu: (event: MouseEvent, target: MenuTarget) => void;
  onMove:
    | ((source: TreeDragItem, destFolderId: string | null) => void)
    | undefined;
  paraSpaces: ParaSpaceSummary[];
  dialogs: ReactNode;
}) {
  const showGuestTitle = !(user || folderId || userLoading);
  const childrenFolders = useMemo(
    () =>
      user || folderId
        ? (visibleFolder?.children ?? EMPTY_CHILDREN)
        : publicFolders,
    [user, folderId, visibleFolder, publicFolders],
  );
  const loadChildren = useCallback(
    (id: string, options: { cursor: string | null; limit?: number }) =>
      fetchFolderChildren(id, {
        cursor: options.cursor ?? undefined,
        limit: options.limit,
        viewerId: user?.id ?? null,
      }),
    [user?.id],
  );
  const treeUpHref = user ? "/shared" : "/";
  const breadcrumbHref = flags.sharedDrive
    ? `/d/${visibleFolder?.ownerId ?? ""}`
    : "/";
  const treeRootName = flags.sharedDrive
    ? visibleFolder?.subjectName
    : undefined;
  return (
    <section>
      {showGuestTitle && (
        <h1 className="mb-3 text-lg font-semibold">全体公開</h1>
      )}
      {error && <ErrorText>{error}</ErrorText>}
      {cacheWarning && <p role="status">{cacheWarning}</p>}
      {flags.showTree ? (
        <NoteTree
          breadcrumbHref={breadcrumbHref}
          childrenFolders={childrenFolders}
          crumbs={visibleFolder?.crumbs ?? []}
          currentFolderId={visibleFolder?.id ?? null}
          isDriveRoot={flags.isDriveRoot}
          loadChildren={loadChildren}
          medallionForPath={medallionForPath}
          notes={notes}
          onItemMenu={onItemMenu}
          onMove={onMove}
          openMenuId={menu?.id}
          paraSpaces={paraSpaces}
          parentId={visibleFolder?.parentId ?? null}
          pending={flags.listPending}
          placeholder={flags.showPlaceholder}
          rootHref={treeUpHref}
          rootName={treeRootName}
          showAllNotes={!(user || folderId)}
          showRootCrumb={flags.canAdmin || flags.sharedDrive}
        />
      ) : null}
      {dialogs}
    </section>
  );
}

function folderIdForRoute(
  driveId: string | undefined,
  driveLookup: "idle" | "loading" | "ready" | "error",
  driveRootId: string | null,
  routeFolderId: string | undefined,
): string | undefined {
  if (!driveId) {
    return routeFolderId;
  }
  if (driveLookup === "ready" && driveRootId) {
    return driveRootId;
  }
  return undefined;
}

function NetworkHomePage() {
  const navigate = useNavigate();
  const { folderId: routeFolderId, driveId } = useParams();
  const [driveRootId, setDriveRootId] = useState<string | null>(null);
  const [driveLookup, setDriveLookup] = useState<
    "idle" | "loading" | "ready" | "error"
  >(driveId ? "loading" : "idle");
  const [membersOpen, setMembersOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const { user, userLoading, viewer, setHeader } =
    useOutletContext<AppShellContext>();
  // §2.4 opt-in: PARA UI and /api/para calls only exist while the flag is on.
  const paraEnabled = useKnowledgeFeature("para");
  // §2.6: medallion UI (folder menu item, tree badges) is feature-gated too.
  const layersEnabled = useKnowledgeFeature("layers");
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [visibleFolder, setVisibleFolder] = useState<FolderAccess | null>(null);
  const [folderPending, setFolderPending] = useState(true);
  const [publicFolders, setPublicFolders] = useState<FolderRecord[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cacheWarning, setCacheWarning] = useState<string | null>(null);
  const [reloadRequest, setReloadRequest] = useState(0);
  const latestReloadRequest = useRef(reloadRequest);
  latestReloadRequest.current = reloadRequest;
  const notesRef = useRef<NoteSummary[]>([]);
  const visibleFolderRef = useRef<FolderAccess | null>(null);
  const reloadOwnerRef = useRef(0);
  const homeReadOwnerRef = useRef<object | null>(null);
  const homeReadActiveRef = useRef(false);
  const invalidationRetryRef = useRef(false);
  const folderId = folderIdForRoute(
    driveId,
    driveLookup,
    driveRootId,
    routeFolderId,
  );

  useEffect(() => {
    if (!driveId) {
      setDriveRootId(null);
      setDriveLookup("idle");
      return;
    }
    let cancelled = false;
    setDriveLookup("loading");
    setDriveRootId(null);
    void fetchSharedDrive(driveId).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setDriveLookup("error");
        setError(result.error);
        return;
      }
      setDriveRootId(result.data.rootFolderId);
      setDriveLookup("ready");
    });
    return () => {
      cancelled = true;
    };
  }, [driveId]);

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
  const [paraSpaces, setParaSpaces] = useState<ParaSpaceSummary[]>([]);
  const [schemeDialog, setSchemeDialog] = useState<{
    id: string;
    name: string;
    scheme: string | null;
  } | null>(null);
  const [schemeBusy, setSchemeBusy] = useState(false);
  const [schemeError, setSchemeError] = useState<string | null>(null);
  const [schemeSuggestion, setSchemeSuggestion] =
    useState<SchemeSuggestion | null>(null);
  const [medallionSets, setMedallionSets] = useState<MedallionSet[]>([]);
  const [medallionAssignments, setMedallionAssignments] = useState<
    MedallionAssignment[]
  >([]);
  const [medallionDialog, setMedallionDialog] =
    useState<MedallionDialogTarget | null>(null);
  const [medallionBusy, setMedallionBusy] = useState(false);
  const [medallionError, setMedallionError] = useState<string | null>(null);

  const flags = homeListFlags({
    error,
    folderId,
    folderPending,
    user,
    userLoading,
    visibleFolder,
  });
  const headerFolder = headerFolderFor(visibleFolder, folderId);
  const shareLink = shareLinkFor(share);
  // §2.5: the archive menu applies inside any space's Projects bucket.
  const paraProjectsPaths = useMemo(
    () =>
      paraSpaces.flatMap((space) =>
        space.buckets
          .filter((bucket) => bucket.key === "projects")
          .map((bucket) => bucket.path),
      ),
    [paraSpaces],
  );

  const subjectOwnerId =
    visibleFolder?.ownerKind === "shared_drive"
      ? visibleFolder.ownerId
      : undefined;
  const reloadPara = useCallback(() => {
    void loadParaSpaces(user, paraEnabled, subjectOwnerId)
      .then(setParaSpaces)
      .catch(() => {
        // PARA section is optional chrome; ignore transient failures.
      });
  }, [user, paraEnabled, subjectOwnerId]);

  useEffect(() => {
    if (user && paraEnabled) {
      reloadPara();
      return;
    }
    setParaSpaces([]);
  }, [user, paraEnabled, reloadPara]);

  const reloadMedallions = useCallback(() => {
    if (!(user && layersEnabled)) {
      setMedallionSets([]);
      setMedallionAssignments([]);
      return;
    }
    void fetchMedallionSets({
      ownerId: subjectOwnerId,
      viewerId: user.id,
    }).then((result) => {
      if (result.ok) {
        setMedallionSets(result.data.sets);
      }
    });
    void fetchMedallionAssignments({
      ownerId: subjectOwnerId,
      viewerId: user.id,
    }).then((result) => {
      if (result.ok) {
        setMedallionAssignments(result.data.assignments);
      }
    });
  }, [user, layersEnabled, subjectOwnerId]);

  useEffect(() => {
    reloadMedallions();
  }, [reloadMedallions]);

  // Nearest-ancestor badge lookup for tree rows (§2.6).
  const medallionForPath = useCallback(
    (path: string | undefined) => {
      if (!(layersEnabled && path)) {
        return null;
      }
      const assignment = resolveMedallionAssignment(medallionAssignments, path);
      if (!assignment) {
        return null;
      }
      const set = medallionSets.find((entry) => entry.id === assignment.setId);
      return {
        label: assignment.layerLabel,
        medal: medalForLayerKey(set?.layers ?? [], assignment.layerKey),
      };
    },
    [layersEnabled, medallionAssignments, medallionSets],
  );

  // 作成ダイアログを開いたら親フォルダの命名規則から「次の番号」ヒントを引く。
  useEffect(() => {
    if (!(folderCreateOpen && visibleFolder?.id)) {
      setSchemeSuggestion(null);
      return;
    }
    const controller = new AbortController();
    void fetchSchemeSuggestion(visibleFolder.id, {
      signal: controller.signal,
      viewerId: user?.id,
    }).then((result) => {
      if (result.ok && !controller.signal.aborted) {
        setSchemeSuggestion(result.data.suggestion);
      }
    });
    return () => controller.abort();
  }, [folderCreateOpen, visibleFolder?.id, user?.id]);

  const refreshAfterMove = useCallback(() => {
    invalidateNotesCache();
    invalidateFolderCache();
    setReloadRequest((value) => value + 1);
    reloadPara();
  }, [reloadPara]);

  const onTreeMove = useCallback(
    (source: TreeDragItem, destFolderId: string | null) => {
      void (async () => {
        const result =
          source.kind === "note"
            ? await moveNotes([source.id], destFolderId)
            : await moveFolder(source.id, { destFolderId });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        refreshAfterMove();
      })();
    },
    [refreshAfterMove],
  );

  const onArchiveProject = useCallback(
    (id: string) => {
      void (async () => {
        const result = await archiveParaProject(id, { dated: true });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        refreshAfterMove();
      })();
    },
    [refreshAfterMove],
  );

  useEffect(() => {
    if (userLoading) {
      return;
    }
    if (driveId && driveLookup !== "ready") {
      setFolderPending(driveLookup !== "error");
      if (driveLookup === "error") {
        setVisibleFolder(null);
        setNotes([]);
      }
      return;
    }
    const controller = new AbortController();
    const owner = {};
    let current = true;
    const requestOwner = reloadRequest;
    homeReadOwnerRef.current = owner;
    homeReadActiveRef.current = true;
    const finishRead = () => {
      if (homeReadOwnerRef.current === owner) {
        homeReadOwnerRef.current = null;
        homeReadActiveRef.current = false;
      }
    };
    const isCurrentOwner = () =>
      current &&
      latestReloadRequest.current === requestOwner &&
      homeReadOwnerRef.current === owner &&
      homeReadActiveRef.current;
    setError(null);
    setCacheWarning(null);
    setFolderPending(true);
    ++reloadOwnerRef.current;
    // A mid-read invalidation aborts once; the next read captures a fresh
    // scope. The flag is consumed by whichever run follows, so a failed retry
    // or a folder/viewer change cannot leave stale state behind.
    const isInvalidationRetry = invalidationRetryRef.current;
    invalidationRetryRef.current = false;
    const shouldRetryInvalidation = (error: unknown): boolean =>
      error instanceof DOMException &&
      error.name === "AbortError" &&
      !isInvalidationRetry;
    const showReadError = (error: unknown): void => {
      setFolderPending(false);
      notesRef.current = [];
      setVisibleFolder(null);
      visibleFolderRef.current = null;
      setPublicFolders([]);
      setNotes([]);
      if (error instanceof HomeMetadataError) {
        setCacheWarning(error.cacheWarning ?? null);
      }
      if (error instanceof HomeMetadataError || error instanceof Error) {
        setError(error.message);
      } else {
        setError("データを取得できませんでした。");
      }
    };
    void readHomeMetadata({
      folderId,
      isCurrentOwner,
      onCacheWarning: (warning) => {
        // Detached cache saves settle after the read finishes, so
        // homeReadActiveRef is already false here; only require that this
        // effect has not been superseded or unmounted.
        if (current && !controller.signal.aborted) {
          setCacheWarning(warning);
        }
      },
      signal: controller.signal,
      viewer,
    })
      .then((snapshot) => {
        const ownerCurrent = isCurrentOwner();
        finishRead();
        if (!ownerCurrent || controller.signal.aborted) {
          return;
        }
        notesRef.current = snapshot.notes;
        visibleFolderRef.current = snapshot.visibleFolder;
        setNotes(snapshot.notes);
        setVisibleFolder(snapshot.visibleFolder);
        setPublicFolders(snapshot.publicFolders);
        setCacheWarning(snapshot.cacheWarning ?? null);
        setFolderPending(false);
      })
      .catch((error: unknown) => {
        const ownerCurrent = isCurrentOwner();
        finishRead();
        if (!ownerCurrent || controller.signal.aborted) {
          return;
        }
        if (shouldRetryInvalidation(error)) {
          invalidationRetryRef.current = true;
          setReloadRequest((value) => value + 1);
          return;
        }
        showReadError(error);
      });
    return () => {
      current = false;
      controller.abort();
      finishRead();
    };
  }, [driveId, driveLookup, folderId, reloadRequest, userLoading, viewer]);

  useEffect(() => {
    if (viewer.cacheViewerId === null) {
      return;
    }
    let active = true;
    const unsubscribe = subscribeOfflineCacheNoteDenial((event) => {
      const receiptOwner = reloadOwnerRef.current;
      if (event.userId !== viewer.cacheViewerId || !active) {
        return;
      }
      const identities = event.resource.aliases.filter((alias) =>
        notesRef.current.some(
          (current) => current.id === alias || current.shortId === alias,
        ),
      );
      if (identities.length === 0) {
        return;
      }
      void readOfflineNoteDenial(event, identities).then((denied) => {
        if (
          denied === false ||
          !active ||
          receiptOwner !== reloadOwnerRef.current ||
          viewer.cacheViewerId !== event.userId
        ) {
          return;
        }
        setReloadRequest((value) => value + 1);
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [viewer.cacheViewerId]);

  useEffect(() => {
    let active = true;
    const targetUserId = viewer.user?.id;
    const unsubscribe = subscribeOfflineCacheFolderDenial((event) => {
      const relationIds = new Set<string | null>([
        folderId ?? null,
        visibleFolderRef.current?.id ?? null,
        ...(visibleFolderRef.current?.children ?? []).map((child) => child.id),
        ...(visibleFolderRef.current?.crumbs ?? []).map((crumb) => crumb.id),
        ...notesRef.current.map((note) => note.folderId),
      ]);
      const relevant = event.resource.aliases.some((id) => relationIds.has(id));
      if (
        active &&
        !homeReadActiveRef.current &&
        event.userId === targetUserId &&
        relevant
      ) {
        const receiptOwner = homeReadOwnerRef.current;
        void readOfflineFolderDenial(event).then((denied) => {
          if (
            active &&
            homeReadOwnerRef.current === receiptOwner &&
            !homeReadActiveRef.current &&
            denied !== null
          ) {
            setReloadRequest((value) => value + 1);
          } else if (
            active &&
            homeReadOwnerRef.current === receiptOwner &&
            !homeReadActiveRef.current
          ) {
            setCacheWarning("オフラインキャッシュを確認できませんでした。");
          }
        });
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [folderId, viewer.user?.id]);

  // Header updates re-render AppShell and this page. Keep its callbacks stable
  // so useHomeHeader does not publish another header on every parent render.
  const handleCreateFolder = useCallback(() => {
    setFolderCreateError(null);
    setFolderCreateOpen(true);
  }, []);
  const handleCreateNote = useCallback(() => {
    void persistNewNote(visibleFolder, navigate, setCreating, setError);
  }, [visibleFolder, navigate]);

  const selection = useMemo<DriveSelection>(() => {
    if (driveId || visibleFolder?.ownerKind === "shared_drive") {
      return {
        id: driveId ?? visibleFolder?.ownerId ?? "",
        kind: "drive",
      };
    }
    if (flags.canAdmin || !routeFolderId) {
      return { kind: "mine" };
    }
    return { kind: "shared" };
  }, [
    driveId,
    flags.canAdmin,
    routeFolderId,
    visibleFolder?.ownerId,
    visibleFolder?.ownerKind,
  ]);
  const handleMembers = useCallback(() => {
    setMembersOpen(true);
  }, []);

  useHomeHeader(
    headerFolder,
    user,
    folderId,
    visibleFolder,
    folderPending,
    selection,
    flags.sharedDrive ? flags.canMutate : flags.canAdmin,
    flags.sharedDrive ? flags.canMutate : true,
    flags.sharedDrive,
    creating,
    setHeader,
    handleCreateFolder,
    handleCreateNote,
    handleMembers,
  );

  return (
    <HomePageView
      cacheWarning={cacheWarning}
      dialogs={
        <>
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
            medallionAssignments={medallionAssignments}
            medallionBusy={medallionBusy}
            medallionDialog={medallionDialog}
            medallionError={medallionError}
            medallionSets={medallionSets}
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
            onCloseMedallion={() => {
              if (!medallionBusy) {
                setMedallionDialog(null);
              }
            }}
            onCloseMenu={() => setMenu(null)}
            onCloseRename={() => {
              if (!folderRenaming) {
                setFolderRename(null);
              }
            }}
            onCloseScheme={() => {
              if (!schemeBusy) {
                setSchemeDialog(null);
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
                { useScheme: schemeSuggestion !== null },
              );
            }}
            onPersistMedallion={(next) => {
              void persistFolderMedallion(
                medallionDialog,
                next,
                folderId,
                user,
                navigate,
                {
                  onMedallionsChanged: reloadMedallions,
                  setMedallionBusy,
                  setMedallionDialog,
                  setMedallionError,
                  setNotes,
                  setVisibleFolder,
                },
              );
            }}
            onPersistScheme={(scheme) => {
              void persistFolderScheme(
                schemeDialog,
                scheme,
                folderId,
                user,
                navigate,
                {
                  setNotes,
                  setSchemeBusy,
                  setSchemeDialog,
                  setSchemeError,
                  setVisibleFolder,
                },
              );
            }}
            onPersistShare={(next) => {
              void persistHomeShare(share, next, visibleFolder?.id, {
                setNotes,
                setShare,
                setShareError,
                setVisibleFolder,
              });
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
              );
            }}
            schemeBusy={schemeBusy}
            schemeDialog={schemeDialog}
            schemeError={schemeError}
            schemeSuggestion={schemeSuggestion}
            share={share}
            shareError={shareError}
            shareLink={shareLink}
            user={user}
          />
          {membersOpen && flags.sharedDrive && visibleFolder?.ownerId && (
            <DriveMembersDialog
              driveId={visibleFolder.ownerId}
              onClose={() => setMembersOpen(false)}
            />
          )}
          {moveTarget && (
            <DriveMoveDialog
              busy={moveBusy}
              error={moveError}
              name={moveTarget.name}
              onClose={() => {
                if (!moveBusy) {
                  setMoveTarget(null);
                }
              }}
              onMove={(destFolderId) => {
                const target = moveTarget;
                setMoveBusy(true);
                setMoveError(null);
                void (async () => {
                  const result =
                    target.kind === "note"
                      ? await moveNotes([target.id], destFolderId)
                      : await moveFolder(target.id, { destFolderId });
                  setMoveBusy(false);
                  if (!result.ok) {
                    setMoveError(result.error);
                    return;
                  }
                  setMoveTarget(null);
                  refreshAfterMove();
                })();
              }}
            />
          )}
        </>
      }
      error={error}
      flags={flags}
      folderId={folderId}
      medallionForPath={medallionForPath}
      menu={menu}
      notes={notes}
      onItemMenu={(event, target) => {
        handleItemMenu(
          event,
          target,
          { canMutate: flags.canMutate, sharedDrive: flags.sharedDrive },
          navigate,
          setMenu,
          (id, name) => {
            void openFolderShare(id, name, setError, setShare, setShareError);
          },
          (note) => {
            void openNoteShare(note, setError, setShare, setShareError);
          },
          (id, name) => {
            setFolderRename({ id, name });
            setFolderRenameError(null);
          },
          (kind, id, name) => {
            setConfirm({ id, kind, name });
            setConfirmError(null);
          },
          {
            onArchive: onArchiveProject,
            onMedallion: layersEnabled
              ? (id, name, path) => {
                  setMedallionDialog({ id, name, path });
                  setMedallionError(null);
                }
              : undefined,
            onMove: (target) => {
              setMoveTarget(target);
              setMoveError(null);
            },
            onScheme: (id, name, scheme) => {
              setSchemeDialog({ id, name, scheme });
              setSchemeError(null);
            },
            // The archive menu item only exists while PARA is enabled —
            // an empty projectsPaths keeps it out of folderMenuItems.
            projectsPaths: paraEnabled ? paraProjectsPaths : [],
          },
        );
      }}
      onMove={flags.canMutate ? onTreeMove : undefined}
      paraSpaces={paraEnabled && flags.isDriveRoot ? paraSpaces : EMPTY_PARA}
      publicFolders={publicFolders}
      user={user}
      userLoading={userLoading}
      visibleFolder={visibleFolder}
    />
  );
}

export function HomePage() {
  const { folderId, driveId } = useParams();
  const { user, userLoading, viewer } = useOutletContext<AppShellContext>();
  const networkViewerKey = JSON.stringify([
    viewer.mode,
    user?.id ?? null,
    viewer.cacheViewerId,
  ]);

  if (driveId || userLoading) {
    return <NetworkHomePage key={networkViewerKey} />;
  }
  if (viewer.mode === "cached" && viewer.cacheViewerId !== null) {
    return (
      <CachedDriveView
        key={JSON.stringify([viewer.cacheViewerId, folderId ?? null])}
      />
    );
  }
  if (viewer.mode === "unavailable") {
    return (
      <p role="status">
        閲覧者を確認できないため、この画面を表示できません。しばらくしてから再試行してください。
      </p>
    );
  }
  return <NetworkHomePage key={networkViewerKey} />;
}

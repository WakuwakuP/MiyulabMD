import type {
  FolderAccess,
  FolderRecord,
  NoteSummary,
} from "@miyulabmd/shared";
import { fetchFolder, fetchNotes, fetchPublicFolders } from "./api.ts";
import { openOfflineCache } from "./offline-cache.ts";
import type { ViewerContext } from "./viewer-context.ts";

export class HomeMetadataError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "HomeMetadataError";
    this.status = status;
  }
}

export type HomeMetadataSnapshot = {
  notes: NoteSummary[];
  visibleFolder: FolderAccess | null;
  publicFolders: FolderRecord[];
  cacheWarning?: string;
};

type ReadHomeMetadataOptions = {
  viewer: ViewerContext;
  folderId: string | undefined;
  signal: AbortSignal;
  isCurrentOwner: () => boolean;
};

function requireResult<T>(
  result: { ok: true; data: T } | { ok: false; status: number; error: string },
): T {
  if (!result.ok) {
    throw new HomeMetadataError(
      result.status === 404 ? "フォルダが見つかりません。" : result.error,
      result.status,
    );
  }
  return result.data;
}

function throwIfCancelled(
  signal: AbortSignal,
  isCurrentOwner: () => boolean,
): void {
  if (signal.aborted) {
    throw signal.reason;
  }
  if (!isCurrentOwner()) {
    throw new DOMException("Home read is no longer current", "AbortError");
  }
}

async function saveHomeMetadata(
  snapshot: HomeMetadataSnapshot,
  viewer: ViewerContext,
  folderId: string | undefined,
  signal: AbortSignal,
  isCurrentOwner: () => boolean,
): Promise<void> {
  if (viewer.mode !== "authenticated" || !viewer.user) {
    return;
  }
  if (viewer.cacheViewerId !== viewer.user.id) {
    snapshot.cacheWarning = "オフラインキャッシュを利用できません。";
    return;
  }
  let cache: Awaited<ReturnType<typeof openOfflineCache>> | undefined;
  try {
    cache = await openOfflineCache({ signal, userId: viewer.user.id });
    throwIfCancelled(signal, isCurrentOwner);
    if (!snapshot.visibleFolder) {
      throw new Error("Authenticated Home response did not include a folder");
    }
    await cache.putFolder(snapshot.visibleFolder, {
      asDriveRoot: folderId == null,
      signal,
    });
    throwIfCancelled(signal, isCurrentOwner);
    await cache.putNoteList(snapshot.notes, { signal });
    throwIfCancelled(signal, isCurrentOwner);
  } catch (error) {
    if (signal.aborted || !isCurrentOwner()) {
      throw error;
    }
    snapshot.cacheWarning = "オフラインキャッシュを保存できませんでした。";
  } finally {
    cache?.close();
  }
}

export async function readHomeMetadata({
  viewer: inputViewer,
  folderId,
  signal,
  isCurrentOwner,
}: ReadHomeMetadataOptions): Promise<HomeMetadataSnapshot> {
  const viewer: ViewerContext = {
    ...inputViewer,
    user: inputViewer.user ? { ...inputViewer.user } : null,
  };
  throwIfCancelled(signal, isCurrentOwner);
  if (viewer.mode !== "authenticated" && viewer.mode !== "guest") {
    throw new HomeMetadataError("ネットワークのホーム情報を利用できません。");
  }
  const notesPromise = fetchNotes({ signal });
  const folderPromise =
    viewer.user || folderId
      ? fetchFolder(folderId, { signal })
      : fetchPublicFolders({ signal });
  const [notes, folderResult] = await Promise.all([
    notesPromise,
    folderPromise,
  ]);
  throwIfCancelled(signal, isCurrentOwner);

  const snapshot: HomeMetadataSnapshot =
    viewer.user || folderId
      ? {
          notes,
          publicFolders: [],
          visibleFolder: requireResult(
            folderResult as Awaited<ReturnType<typeof fetchFolder>>,
          ),
        }
      : {
          notes,
          publicFolders: requireResult(
            folderResult as Awaited<ReturnType<typeof fetchPublicFolders>>,
          ),
          visibleFolder: null,
        };

  await saveHomeMetadata(snapshot, viewer, folderId, signal, isCurrentOwner);
  throwIfCancelled(signal, isCurrentOwner);
  return snapshot;
}

import type { FolderAccess, NoteSummary } from "@miyulabmd/shared";
import {
  isOfflineCacheUserSuspended,
  openOfflineCache,
} from "./offline-cache.ts";

export type CachedDriveView = {
  folder: FolderAccess | null;
  folderCachedAt: number | null;
  folderMissing: boolean;
  notes: NoteSummary[];
  notesCachedAt: number | null;
  notesMissing: boolean;
};

export async function readCachedDrive(
  userId: string,
  folderId: string | null,
  signal?: AbortSignal,
  isCurrent?: () => boolean,
): Promise<CachedDriveView> {
  const cache = await openOfflineCache({ signal, userId });
  try {
    if (signal?.aborted) {
      throw signal.reason;
    }
    const noteList = await cache.getNoteList();
    const folder = await cache.getFolder(folderId);
    if (signal?.aborted) {
      throw signal.reason;
    }
    const result = {
      folder: folder?.folder ?? null,
      folderCachedAt: folder?.cachedAt ?? null,
      folderMissing: folder === null,
      notes: noteList?.notes ?? [],
      notesCachedAt: noteList?.cachedAt ?? null,
      notesMissing: noteList === null,
    };
    if (isCurrent && !isCurrent()) {
      throw new DOMException(
        "Cached drive view is no longer current",
        "AbortError",
      );
    }
    if (isOfflineCacheUserSuspended(userId)) {
      throw new DOMException("Offline cache is suspended");
    }
    return result;
  } finally {
    cache.close();
  }
}

import type { FolderAccess, NoteSummary } from "@miyulabmd/shared";
import { openOfflineCache } from "./offline-cache.ts";

export type CachedDriveView = {
  folder: FolderAccess | null;
  folderCachedAt: number | null;
  notes: NoteSummary[];
  notesCachedAt: number | null;
  folderMissing: boolean;
  notesMissing: boolean;
};

export async function readCachedDrive(
  userId: string,
  folderId: string | null,
  signal?: AbortSignal,
): Promise<CachedDriveView> {
  const cache = await openOfflineCache({ signal, userId });
  try {
    if (signal?.aborted) {
      throw signal.reason;
    }
    const [folder, noteList] = await Promise.all([
      cache.getFolder(folderId),
      cache.getNoteList(),
    ]);
    if (signal?.aborted) {
      throw signal.reason;
    }
    return {
      folder: folder?.folder ?? null,
      folderCachedAt: folder?.cachedAt ?? null,
      folderMissing: folder === null,
      notes: noteList?.notes ?? [],
      notesCachedAt: noteList?.cachedAt ?? null,
      notesMissing: noteList === null,
    };
  } finally {
    cache.close();
  }
}

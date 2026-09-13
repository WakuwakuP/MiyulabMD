import type { FolderRecord, NoteSummary } from "@miyulabmd/shared";
import { fetchFolder, fetchFolderTree, fetchNote, fetchNotes } from "./api.ts";
import { openOfflineCache } from "./offline-cache.ts";
import type { ViewerContext } from "./viewer-context.ts";

export type MyDrivePrefetchResult =
  | { status: "success"; folders: number; notes: number }
  | {
      status: "stopped";
      reason: "aborted" | "auth" | "network" | "storage" | "unavailable";
      folders: number;
      notes: number;
    };

type Counts = { folders: number; notes: number };

function stopped(
  reason: "aborted" | "auth" | "network" | "storage" | "unavailable",
  counts: Counts,
): MyDrivePrefetchResult {
  return { ...counts, reason, status: "stopped" };
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || error === signal.reason;
}

function isAuthStatus(status: number | undefined): boolean {
  return status === 401 || status === 403;
}

function folderIds(tree: FolderRecord[]): Set<string> {
  return new Set(tree.map((folder) => folder.id));
}

function rootFolder(tree: FolderRecord[]): FolderRecord | undefined {
  return tree.find((folder) => folder.parentId === null);
}

function stopReason(
  error: unknown,
  signal: AbortSignal,
  hasCache: boolean,
): "aborted" | "network" | "storage" {
  if (isAbort(error, signal)) {
    return "aborted";
  }
  if (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "InvalidStateError")
  ) {
    return "storage";
  }
  return hasCache ? "network" : "storage";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: acquisition ordering and stop boundaries are intentionally explicit.
export async function prefetchMyDrive(
  viewer: ViewerContext,
  options: { signal?: AbortSignal } = {},
): Promise<MyDrivePrefetchResult> {
  const ownedViewer: ViewerContext = {
    ...viewer,
    user: viewer.user ? { ...viewer.user } : null,
  };
  const signal = options.signal ?? new AbortController().signal;
  const counts: Counts = { folders: 0, notes: 0 };
  if (
    ownedViewer.mode !== "authenticated" ||
    !ownedViewer.user ||
    ownedViewer.cacheViewerId !== ownedViewer.user.id
  ) {
    return stopped("unavailable", counts);
  }

  let cache: Awaited<ReturnType<typeof openOfflineCache>> | null = null;
  try {
    cache = await openOfflineCache({ signal, userId: ownedViewer.user.id });
    const treeResult = await fetchFolderTree({ signal });
    if (!treeResult.ok) {
      return stopped(
        isAuthStatus(treeResult.status) ? "auth" : "network",
        counts,
      );
    }
    const ownedFolders = folderIds(treeResult.data);
    const root = rootFolder(treeResult.data);
    if (!root) {
      return stopped("network", counts);
    }

    const rootResult = await fetchFolder(root.id, { signal });
    if (!rootResult.ok) {
      return stopped(
        isAuthStatus(rootResult.status) ? "auth" : "network",
        counts,
      );
    }
    await cache.putFolder(rootResult.data, { asDriveRoot: true, signal });
    counts.folders += 1;

    for (const folder of treeResult.data) {
      if (folder.id === root.id) {
        continue;
      }
      const result = await fetchFolder(folder.id, { signal });
      if (!result.ok) {
        return stopped(
          isAuthStatus(result.status) ? "auth" : "network",
          counts,
        );
      }
      await cache.putFolder(result.data, { signal });
      counts.folders += 1;
    }

    const summaries = await fetchNotes({ signal });
    await cache.putNoteList(summaries, { signal });
    const targets = summaries.filter(
      (summary: NoteSummary) =>
        summary.ownerId === ownedViewer.user?.id &&
        summary.folderId !== null &&
        ownedFolders.has(summary.folderId),
    );
    for (const summary of targets) {
      const existing = await cache.getNote(summary.id);
      if (existing && existing.note.updatedAt >= summary.updatedAt) {
        continue;
      }
      const orderingToken = cache.beginNoteRead(summary.id);
      const result = await fetchNote(summary.id, { signal });
      if (!result.ok) {
        if (isAuthStatus(result.status)) {
          return stopped("auth", counts);
        }
        continue;
      }
      await cache.putNote(result.data, { orderingToken, signal });
      counts.notes += 1;
    }
    return { ...counts, status: "success" };
  } catch (error) {
    return stopped(stopReason(error, signal, cache !== null), counts);
  } finally {
    cache?.close();
  }
}

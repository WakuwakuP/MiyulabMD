import type { FolderRecord, NoteSummary } from "@miyulabmd/shared";
import {
  ApiHttpError,
  fetchFolder,
  fetchFolderTree,
  fetchNote,
  fetchNotes,
} from "./api.ts";
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

function throwIfPrefetchAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason;
  }
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
  operation: "network" | "storage",
): "aborted" | "auth" | "network" | "storage" {
  if (isAbort(error, signal)) {
    return "aborted";
  }
  if (error instanceof ApiHttpError && isAuthStatus(error.status)) {
    return "auth";
  }
  return operation;
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
  if (signal.aborted) {
    return stopped("aborted", counts);
  }
  if (
    ownedViewer.mode !== "authenticated" ||
    !ownedViewer.user ||
    ownedViewer.cacheViewerId !== ownedViewer.user.id
  ) {
    return stopped("unavailable", counts);
  }

  let cache: Awaited<ReturnType<typeof openOfflineCache>> | null = null;
  let operation: "network" | "storage" = "network";
  let result: MyDrivePrefetchResult | undefined;
  try {
    operation = "storage";
    cache = await openOfflineCache({ signal, userId: ownedViewer.user.id });
    operation = "network";
    const treeResult = await fetchFolderTree({ signal });
    // biome-ignore lint/style/noNegationElse: keeping the stop branch adjacent to the response boundary
    if (!treeResult.ok) {
      result = stopped(
        isAuthStatus(treeResult.status) ? "auth" : "network",
        counts,
      );
    } else {
      const ownedFolders = folderIds(treeResult.data);
      const root = rootFolder(treeResult.data);
      // biome-ignore lint/style/noNegationElse: keeping the empty-tree stop branch explicit
      if (!root) {
        result = stopped("network", counts);
      } else {
        throwIfPrefetchAborted(signal);
        const rootResult = await fetchFolder(root.id, { signal });
        // biome-ignore lint/style/noNegationElse: keeping the HTTP stop branch adjacent to the response
        if (!rootResult.ok) {
          result = stopped(
            isAuthStatus(rootResult.status) ? "auth" : "network",
            counts,
          );
        } else {
          operation = "storage";
          throwIfPrefetchAborted(signal);
          await cache.putFolder(rootResult.data, {
            asDriveRoot: true,
            signal,
          });
          counts.folders += 1;

          for (const folder of treeResult.data) {
            throwIfPrefetchAborted(signal);
            if (folder.id === root.id) {
              continue;
            }
            operation = "network";
            throwIfPrefetchAborted(signal);
            const folderResult = await fetchFolder(folder.id, { signal });
            if (!folderResult.ok) {
              result = stopped(
                isAuthStatus(folderResult.status) ? "auth" : "network",
                counts,
              );
              break;
            }
            operation = "storage";
            throwIfPrefetchAborted(signal);
            await cache.putFolder(folderResult.data, { signal });
            counts.folders += 1;
          }

          if (!result) {
            operation = "network";
            throwIfPrefetchAborted(signal);
            const summaries = await fetchNotes({ signal });
            operation = "storage";
            throwIfPrefetchAborted(signal);
            await cache.putNoteList(summaries, { signal });
            const targets = summaries.filter(
              (summary: NoteSummary) =>
                summary.ownerId === ownedViewer.user?.id &&
                summary.folderId !== null &&
                ownedFolders.has(summary.folderId),
            );
            for (const summary of targets) {
              throwIfPrefetchAborted(signal);
              operation = "storage";
              throwIfPrefetchAborted(signal);
              const existing = await cache.getNote(summary.id);
              if (existing && existing.note.updatedAt >= summary.updatedAt) {
                continue;
              }
              const orderingToken = cache.beginNoteRead(summary.id);
              operation = "network";
              throwIfPrefetchAborted(signal);
              const noteResult = await fetchNote(summary.id, { signal });
              if (!noteResult.ok) {
                if (noteResult.status === 401) {
                  result = stopped("auth", counts);
                  break;
                }
                if (noteResult.status === 403 || noteResult.status === 404) {
                  try {
                    operation = "storage";
                    await cache.denyNote(summary.id);
                  } catch {
                    result = stopped("storage", counts);
                    break;
                  }
                }
                continue;
              }
              operation = "storage";
              throwIfPrefetchAborted(signal);
              await cache.putNote(noteResult.data, {
                orderingToken,
                signal,
              });
              await cache.clearNoteDenial(summary.id, orderingToken);
              counts.notes += 1;
            }
            if (!result) {
              result = { ...counts, status: "success" };
            }
          }
        }
      }
    }
  } catch (error) {
    result = stopped(stopReason(error, signal, operation), counts);
  } finally {
    if (cache) {
      try {
        cache.close();
      } catch {
        if (signal.aborted) {
          result = stopped("aborted", counts);
        } else {
          result = stopped("storage", counts);
        }
      }
      if (signal.aborted) {
        result = stopped("aborted", counts);
      }
    }
  }
  return result ?? stopped(signal.aborted ? "aborted" : "network", counts);
}

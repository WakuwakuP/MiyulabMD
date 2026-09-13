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

type IoBoundary = "network" | "storage";

class PrefetchIoError extends Error {
  constructor(
    readonly boundary: IoBoundary,
    readonly cause: unknown,
  ) {
    super(`Prefetch ${boundary} operation failed`);
  }
}

async function prefetchIo<T>(
  signal: AbortSignal,
  boundary: IoBoundary,
  operation: () => Promise<T> | T,
): Promise<T> {
  throwIfPrefetchAborted(signal);
  try {
    return await operation();
  } catch (error) {
    throw new PrefetchIoError(boundary, error);
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
): "aborted" | "auth" | "network" | "storage" {
  const boundary =
    error instanceof PrefetchIoError ? error.boundary : "network";
  const cause = error instanceof PrefetchIoError ? error.cause : error;
  if (isAbort(cause, signal)) {
    return "aborted";
  }
  if (cause instanceof ApiHttpError && isAuthStatus(cause.status)) {
    return "auth";
  }
  return boundary;
}

type PrefetchCache = Awaited<ReturnType<typeof openOfflineCache>>;

async function acquireFolders(
  cache: PrefetchCache,
  signal: AbortSignal,
  tree: FolderRecord[],
  counts: Counts,
): Promise<"aborted" | "auth" | "network" | "storage" | null> {
  const root = rootFolder(tree);
  if (!root) {
    return "network";
  }
  const rootResult = await prefetchIo(signal, "network", () =>
    fetchFolder(root.id, { signal }),
  );
  if (!rootResult.ok) {
    return isAuthStatus(rootResult.status) ? "auth" : "network";
  }
  await prefetchIo(signal, "storage", () =>
    cache.putFolder(rootResult.data, { asDriveRoot: true, signal }),
  );
  counts.folders += 1;

  for (const folder of tree) {
    if (folder.id === root.id) {
      continue;
    }
    const folderResult = await prefetchIo(signal, "network", () =>
      fetchFolder(folder.id, { signal }),
    );
    if (!folderResult.ok) {
      return isAuthStatus(folderResult.status) ? "auth" : "network";
    }
    await prefetchIo(signal, "storage", () =>
      cache.putFolder(folderResult.data, { signal }),
    );
    counts.folders += 1;
  }
  return null;
}

async function acquireDrive(
  cache: PrefetchCache,
  signal: AbortSignal,
  userId: string,
  counts: Counts,
): Promise<MyDrivePrefetchResult> {
  const treeResult = await prefetchIo(signal, "network", () =>
    fetchFolderTree({ signal }),
  );
  if (!treeResult.ok) {
    return stopped(
      isAuthStatus(treeResult.status) ? "auth" : "network",
      counts,
    );
  }
  const folderStop = await acquireFolders(
    cache,
    signal,
    treeResult.data,
    counts,
  );
  if (folderStop) {
    return stopped(folderStop, counts);
  }
  const notesStop = await acquireNotes(
    cache,
    signal,
    userId,
    folderIds(treeResult.data),
    counts,
  );
  return notesStop
    ? stopped(notesStop, counts)
    : { ...counts, status: "success" };
}

async function acquireNotes(
  cache: PrefetchCache,
  signal: AbortSignal,
  userId: string,
  ownedFolders: Set<string>,
  counts: Counts,
): Promise<"aborted" | "auth" | "network" | "storage" | null> {
  const summaries = await prefetchIo(signal, "network", () =>
    fetchNotes({ signal }),
  );
  await prefetchIo(signal, "storage", () =>
    cache.putNoteList(summaries, { signal }),
  );
  const targets = summaries.filter(
    (summary: NoteSummary) =>
      summary.ownerId === userId &&
      summary.folderId !== null &&
      ownedFolders.has(summary.folderId),
  );
  for (const summary of targets) {
    const existing = await prefetchIo(signal, "storage", () =>
      cache.getNote(summary.id),
    );
    if (existing && existing.note.updatedAt >= summary.updatedAt) {
      continue;
    }
    const orderingToken = await prefetchIo(signal, "storage", () =>
      cache.beginNoteRead(summary.id),
    );
    const noteResult = await prefetchIo(signal, "network", () =>
      fetchNote(summary.id, { signal, viewerId: userId }),
    );
    if (!noteResult.ok) {
      if (noteResult.status === 401) {
        return "auth";
      }
      if (noteResult.status === 403 || noteResult.status === 404) {
        await prefetchIo(signal, "storage", () => cache.denyNote(summary.id));
      }
      continue;
    }
    await prefetchIo(signal, "storage", () =>
      cache.putNote(noteResult.data, { orderingToken, signal }),
    );
    await prefetchIo(signal, "storage", () =>
      cache.clearNoteDenial(summary.id, orderingToken),
    );
    counts.notes += 1;
  }
  return null;
}

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

  const userId = ownedViewer.user.id;
  let cache: PrefetchCache | null = null;
  let outcome: MyDrivePrefetchResult;
  try {
    cache = await prefetchIo(signal, "storage", () =>
      openOfflineCache({ signal, userId }),
    );
    throwIfPrefetchAborted(signal);
    outcome = await acquireDrive(cache, signal, userId, counts);
  } catch (error) {
    outcome = stopped(stopReason(error, signal), counts);
  } finally {
    if (cache) {
      try {
        cache.close();
      } catch {
        outcome = stopped(signal.aborted ? "aborted" : "storage", counts);
      }
      if (signal.aborted) {
        outcome = stopped("aborted", counts);
      }
    }
  }
  return outcome;
}

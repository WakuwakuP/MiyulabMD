// Canonical candidate v9; see decisions.md for transaction-terminal rationale.
import type { FolderAccess, Note, NoteSummary } from "@miyulabmd/shared";

import {
  beginNoteReadOrder,
  clearUserNoteReadOrder,
  currentNoteReadGeneration,
  enterNoteDenialOrder,
  isCurrentNoteReadOrder,
} from "./note-access-order.ts";

const DATABASE_NAME = "miyulabmd-offline-cache";
const DATABASE_VERSION = 4;
const NOTE_STORE = "notes";
const FOLDER_STORE = "folders";
const NOTE_LIST_STORE = "note-lists";
const METADATA_STORE = "metadata";
const VIEWER_ID_METADATA_KEY = "viewer-id";
const DRIVE_ROOT_METADATA_PREFIX = "drive-root:";
const DENIED_NOTE_PREFIX = "denied-note:";
const DENIED_FOLDER_PREFIX = "denied-folder:";
const OPFS_ROOT = "miyulabmd-offline-cache-v1";

type NoteRecord = {
  key: string;
  userId: string;
  noteId: string;
  note: Omit<Note, "markdown">;
  fileName: string;
  cachedAt: number;
};

type FolderRecord = {
  key: string;
  userId: string;
  folderId: string | null;
  folder: FolderAccess;
  cachedAt: number;
};

type NoteListRecord = {
  key: string;
  userId: string;
  notes: NoteSummary[];
  cachedAt: number;
};

type MetadataRecord = {
  key: string;
  value: string;
};

type StoreRecord = {
  storeName: string;
  record: NoteRecord | FolderRecord | NoteListRecord | MetadataRecord;
};

type OfflineCache = {
  putNote(
    note: Note,
    options?: CancellationOptions & { orderingToken?: number },
  ): Promise<void>;
  beginNoteRead(id: string): number;
  denyNote(id: string, orderingToken?: number): Promise<void>;
  clearNoteDenial(id: string, orderingToken?: number): Promise<void>;
  denyFolder(id: string): Promise<void>;
  getNote(id: string): Promise<{ note: Note; cachedAt: number } | null>;
  putNoteList(
    notes: NoteSummary[],
    options?: CancellationOptions,
  ): Promise<void>;
  getNoteList(): Promise<{ notes: NoteSummary[]; cachedAt: number } | null>;
  putFolder(
    folder: FolderAccess,
    options?: { asDriveRoot?: boolean } & CancellationOptions,
  ): Promise<void>;
  getFolder(
    id: string | null,
  ): Promise<{ folder: FolderAccess; cachedAt: number } | null>;
  close(): void;
};

export type OpenOfflineCacheOptions = {
  userId: string;
};

type CancellationOptions = {
  signal?: AbortSignal;
};

const suspendedUsers = new Set<string>();
const userLifetimes = new Map<string, number>();
const pendingUserOperations = new Map<string, Set<() => void>>();
const openUserCaches = new Map<string, Set<() => void>>();
const clearLifetimes = new Map<string, number>();
const userClearOperations = new Map<string, Promise<void>>();
const pendingUserWrites = new Map<string, Set<Promise<void>>>();

export function suspendOfflineCacheUser(userId: string): void {
  suspendedUsers.add(userId);
  userLifetimes.set(userId, (userLifetimes.get(userId) ?? 0) + 1);
  for (const abort of pendingUserOperations.get(userId) ?? []) {
    abort();
  }
}

export function isOfflineCacheUserSuspended(userId: string): boolean {
  return suspendedUsers.has(userId);
}

export function captureOfflineCacheUserClearLifetime(userId: string): number {
  return clearLifetimes.get(userId) ?? 0;
}

export function isOfflineCacheUserClearLifetimeCurrent(
  userId: string,
  lifetime: number,
): boolean {
  return captureOfflineCacheUserClearLifetime(userId) === lifetime;
}

function isUserSuspended(userId: string): boolean {
  return suspendedUsers.has(userId);
}

function currentUserLifetime(userId: string): number {
  return userLifetimes.get(userId) ?? 0;
}

function assertUserActive(userId: string, lifetime: number): void {
  if (isUserSuspended(userId) || currentUserLifetime(userId) !== lifetime) {
    throw new Error("Offline cache is suspended");
  }
}

export function beginOfflineNoteRead(userId: string, noteId: string): number {
  return beginNoteReadOrder(userId, noteId);
}

export function enterOfflineNoteDenial(userId: string, noteId: string): number {
  return enterNoteDenialOrder(userId, noteId);
}

export function isOfflineNoteReadCurrent(
  userId: string,
  noteId: string,
  token: number,
): boolean {
  return isCurrentNoteReadOrder(userId, noteId, token);
}

function deniedNoteKey(userId: string, noteId: string): string {
  return `${DENIED_NOTE_PREFIX}${noteKey(userId, noteId)}`;
}

function currentNoteGeneration(userId: string, noteId: string): number {
  return currentNoteReadGeneration(userId, noteId);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason;
  }
}

function encodePathPart(value: string): string {
  // Encode UTF-8 bytes rather than the string itself so every path component
  // is safe even when an ID contains slashes or filesystem punctuation.
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function noteKey(userId: string, noteId: string): string {
  return `${encodePathPart(userId)}:${encodePathPart(noteId)}`;
}

function folderKey(userId: string, folderId: string | null): string {
  return JSON.stringify([userId, folderId]);
}

function noteListKey(userId: string): string {
  return encodePathPart(userId);
}

function driveRootMetadataKey(userId: string): string {
  return `${DRIVE_ROOT_METADATA_PREFIX}${encodePathPart(userId)}`;
}

function deniedFolderKey(userId: string, folderId: string): string {
  return `${DENIED_FOLDER_PREFIX}${encodePathPart(userId)}:${encodePathPart(folderId)}`;
}

function openDatabase(signal?: AbortSignal): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(NOTE_STORE)) {
        request.result.createObjectStore(NOTE_STORE, { keyPath: "key" });
      }
      if (!request.result.objectStoreNames.contains(FOLDER_STORE)) {
        request.result.createObjectStore(FOLDER_STORE, { keyPath: "key" });
      }
      if (!request.result.objectStoreNames.contains(NOTE_LIST_STORE)) {
        request.result.createObjectStore(NOTE_LIST_STORE, { keyPath: "key" });
      }
      if (!request.result.objectStoreNames.contains(METADATA_STORE)) {
        request.result.createObjectStore(METADATA_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(request.result);
    };
    request.onerror = () => {
      if (settled) {
        return;
      }
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      reject(request.error);
    };
  });
}

function clearUserRecords(
  database: IDBDatabase,
  userId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(
        [NOTE_STORE, FOLDER_STORE, NOTE_LIST_STORE, METADATA_STORE],
        "readwrite",
      );
      for (const storeName of [NOTE_STORE, FOLDER_STORE, NOTE_LIST_STORE]) {
        const request = transaction.objectStore(storeName).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            return;
          }
          if ((cursor.value as { userId?: string }).userId === userId) {
            cursor.delete();
          }
          cursor.continue();
        };
        request.onerror = () => transaction.abort();
      }
      const metadata = transaction.objectStore(METADATA_STORE);
      const request = metadata.openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          return;
        }
        const key = String(cursor.key);
        if (
          key === driveRootMetadataKey(userId) ||
          key.startsWith(`${DENIED_NOTE_PREFIX}${noteListKey(userId)}:`) ||
          key.startsWith(`${DENIED_FOLDER_PREFIX}${encodePathPart(userId)}:`)
        ) {
          cursor.delete();
        }
        cursor.continue();
      };
      const viewer = metadata.get(VIEWER_ID_METADATA_KEY);
      viewer.onsuccess = () => {
        if ((viewer.result as MetadataRecord | undefined)?.value === userId) {
          metadata.delete(VIEWER_ID_METADATA_KEY);
        }
      };
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => undefined;
    transaction.onabort = () =>
      reject(transaction.error ?? new DOMException("Transaction aborted"));
  });
}

async function clearUserFiles(userId: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  try {
    const app = await root.getDirectoryHandle(OPFS_ROOT);
    await app.removeEntry(encodePathPart(userId), { recursive: true });
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "NotFoundError")) {
      throw error;
    }
  }
}

async function purgeOfflineCacheUser(userId: string): Promise<void> {
  if (!userId) {
    throw new Error("A user ID is required");
  }
  if (!("indexedDB" in globalThis && navigator.storage?.getDirectory)) {
    throw new Error("Offline cache storage is unavailable");
  }
  clearLifetimes.set(userId, captureOfflineCacheUserClearLifetime(userId) + 1);
  clearUserNoteReadOrder(userId);
  suspendOfflineCacheUser(userId);
  for (const close of openUserCaches.get(userId) ?? []) {
    close();
  }
  await Promise.all(pendingUserWrites.get(userId) ?? []);
  const database = await openDatabase();
  try {
    await clearUserRecords(database, userId);
    await clearUserFiles(userId);
    suspendedUsers.delete(userId);
  } finally {
    database.close();
  }
}

export function clearOfflineCacheUser(userId: string): Promise<void> {
  const existing = userClearOperations.get(userId);
  if (existing) {
    return existing;
  }
  const operation = purgeOfflineCacheUser(userId).finally(() => {
    userClearOperations.delete(userId);
  });
  userClearOperations.set(userId, operation);
  return operation;
}

function commitTransaction(
  database: IDBDatabase,
  storeName: string,
  record: NoteRecord | MetadataRecord,
  userId: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      throwIfAborted(signal);
      transaction = database.transaction(storeName, "readwrite");
    } catch (error) {
      reject(error);
      return;
    }
    let settled = false;
    let requestError: DOMException | null = null;
    const operations =
      pendingUserOperations.get(userId) ?? new Set<() => void>();
    pendingUserOperations.set(userId, operations);
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
      operations.delete(onAbort);
      if (!operations.size) {
        pendingUserOperations.delete(userId);
      }
    };
    const finish = (callback: () => void) => {
      if (!settled) {
        settled = true;
        cleanup();
        callback();
      }
    };
    const onAbort = () => {
      try {
        transaction.abort();
      } catch {
        // Completion may already be in progress; the terminal event wins.
      }
    };
    operations.add(onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      throwIfAborted(signal);
      transaction.objectStore(storeName).put(record);
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // Preserve the synchronous request error.
      }
      finish(() => reject(error));
      return;
    }
    transaction.oncomplete = () => finish(resolve);
    transaction.onerror = () => {
      requestError = transaction.error;
    };
    transaction.onabort = () =>
      finish(() =>
        reject(
          signal?.aborted
            ? signal.reason
            : (requestError ??
                transaction.error ??
                new DOMException("Transaction aborted")),
        ),
      );
  });
}

function readRecord(
  database: IDBDatabase,
  key: string,
): Promise<NoteRecord | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(NOTE_STORE, "readonly");
    const request = transaction.objectStore(NOTE_STORE).get(key);
    request.onsuccess = () => resolve(request.result as NoteRecord | undefined);
    request.onerror = () => reject(request.error);
  });
}

function commitFolderRecord(
  database: IDBDatabase,
  record: FolderRecord,
  userId: string,
  signal?: AbortSignal,
): Promise<void> {
  return commitStoreRecord(database, FOLDER_STORE, record, userId, signal);
}

function readFolderRecord(
  database: IDBDatabase,
  key: string,
): Promise<FolderRecord | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(FOLDER_STORE, "readonly");
    const request = transaction.objectStore(FOLDER_STORE).get(key);
    request.onsuccess = () =>
      resolve(request.result as FolderRecord | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function readFolderForRoute(
  database: IDBDatabase,
  userId: string,
  id: string | null,
): Promise<FolderRecord | undefined> {
  if (id !== null) {
    return readFolderRecord(database, folderKey(userId, id));
  }
  const rootReference = await readMetadataRecord(
    database,
    driveRootMetadataKey(userId),
  );
  if (!rootReference) {
    return readFolderRecord(database, folderKey(userId, null));
  }
  try {
    const rootId = JSON.parse(rootReference.value) as string | null;
    return readFolderRecord(database, folderKey(userId, rootId));
  } catch {
    return undefined;
  }
}

function commitNoteListRecord(
  database: IDBDatabase,
  record: NoteListRecord,
  userId: string,
  signal?: AbortSignal,
): Promise<void> {
  return commitStoreRecord(database, NOTE_LIST_STORE, record, userId, signal);
}

function commitStoreRecord(
  database: IDBDatabase,
  storeName: string,
  record: FolderRecord | NoteListRecord,
  userId: string,
  signal?: AbortSignal,
): Promise<void> {
  return commitStoreRecords(database, [{ record, storeName }], userId, signal);
}

function commitStoreRecords(
  database: IDBDatabase,
  records: StoreRecord[],
  userId: string,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      throwIfAborted(signal);
      transaction = database.transaction(
        [...new Set(records.map(({ storeName }) => storeName))],
        "readwrite",
      );
    } catch (error) {
      reject(error);
      return;
    }
    const operations =
      pendingUserOperations.get(userId) ?? new Set<() => void>();
    pendingUserOperations.set(userId, operations);
    let settled = false;
    let putError: unknown;
    const abort = () => {
      try {
        transaction.abort();
      } catch {
        // The terminal event has already won.
      }
    };
    const onAbort = () => abort();
    const finish = (callback: () => void) => {
      if (!settled) {
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        operations.delete(abort);
        if (!operations.size) {
          pendingUserOperations.delete(userId);
        }
        callback();
      }
    };
    operations.add(abort);
    signal?.addEventListener("abort", onAbort, { once: true });
    transaction.oncomplete = () => finish(resolve);
    transaction.onerror = () => {
      // The abort event is the single terminal rejection boundary.
    };
    transaction.onabort = () =>
      finish(() =>
        reject(
          signal?.aborted
            ? signal.reason
            : (putError ??
                transaction.error ??
                new DOMException("Transaction aborted")),
        ),
      );
    try {
      throwIfAborted(signal);
      for (const { storeName, record } of records) {
        transaction.objectStore(storeName).put(record);
      }
    } catch (error) {
      putError = error;
      abort();
    }
  });
}

function readNoteListRecord(
  database: IDBDatabase,
  key: string,
): Promise<NoteListRecord | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(NOTE_LIST_STORE, "readonly");
    const request = transaction.objectStore(NOTE_LIST_STORE).get(key);
    request.onsuccess = () =>
      resolve(request.result as NoteListRecord | undefined);
    request.onerror = () => reject(request.error);
  });
}

function readMetadataRecord(
  database: IDBDatabase,
  key: string,
): Promise<MetadataRecord | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(METADATA_STORE, "readonly");
    const request = transaction.objectStore(METADATA_STORE).get(key);
    request.onsuccess = () =>
      resolve(request.result as MetadataRecord | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function readDeniedNote(
  database: IDBDatabase,
  userId: string,
  noteId: string,
): Promise<boolean> {
  return Boolean(
    await readMetadataRecord(database, deniedNoteKey(userId, noteId)),
  );
}

function readDeniedFolderIds(
  database: IDBDatabase,
  userId: string,
): Promise<Set<string>> {
  const prefix = `${DENIED_FOLDER_PREFIX}${encodePathPart(userId)}:`;
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(METADATA_STORE, "readonly");
    const request = transaction
      .objectStore(METADATA_STORE)
      .openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
    const denied = new Set<string>();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(denied);
        return;
      }
      const record = cursor.value as MetadataRecord;
      if (record.value) {
        denied.add(record.value);
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

function projectDeniedFolder(
  folder: FolderAccess,
  deniedFolderIds: Set<string>,
): FolderAccess | null {
  if (folder.id !== null && deniedFolderIds.has(folder.id)) {
    return null;
  }
  const deniedCrumbIndex = folder.crumbs.reduce(
    (lastIndex, crumb, index) =>
      deniedFolderIds.has(crumb.id) ? index : lastIndex,
    -1,
  );
  const children = folder.children.filter(
    (child) => !deniedFolderIds.has(child.id),
  );
  if (deniedCrumbIndex < 0) {
    return { ...folder, children };
  }
  const crumbs = folder.crumbs.slice(deniedCrumbIndex + 1);
  return {
    ...folder,
    children: children.map(({ folder: _folder, ...child }) => child),
    crumbs,
    folder: undefined,
    parentId: crumbs.length >= 2 ? (crumbs.at(-2)?.id ?? null) : null,
    sourceFolder: null,
  };
}

function removeCachedNote(
  database: IDBDatabase,
  userId: string,
  noteId: string,
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    let removedFileName: string | null = null;
    try {
      transaction = database.transaction(
        [NOTE_STORE, NOTE_LIST_STORE],
        "readwrite",
      );
      const notes = transaction.objectStore(NOTE_STORE);
      const noteRequest = notes.get(noteKey(userId, noteId));
      noteRequest.onsuccess = () => {
        const record = noteRequest.result as NoteRecord | undefined;
        removedFileName = record?.fileName ?? null;
        notes.delete(noteKey(userId, noteId));
        const lists = transaction.objectStore(NOTE_LIST_STORE);
        const listRequest = lists.get(noteListKey(userId));
        listRequest.onsuccess = () => {
          const list = listRequest.result as NoteListRecord | undefined;
          if (list) {
            lists.put({
              ...list,
              notes: list.notes.filter((item) => item.id !== noteId),
            });
          }
        };
        listRequest.onerror = () => transaction.abort();
      };
      noteRequest.onerror = () => transaction.abort();
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(removedFileName);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new DOMException("Transaction aborted"));
  });
}

function deleteMetadata(
  database: IDBDatabase,
  key: string,
  userId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = database.transaction(METADATA_STORE, "readwrite");
      transaction.objectStore(METADATA_STORE).delete(key);
    } catch (error) {
      reject(error);
      return;
    }
    const operations =
      pendingUserOperations.get(userId) ?? new Set<() => void>();
    pendingUserOperations.set(userId, operations);
    let settled = false;
    const abort = () => {
      try {
        transaction.abort();
      } catch {
        // The terminal event has already won.
      }
    };
    const finish = (callback: () => void) => {
      if (!settled) {
        settled = true;
        operations.delete(abort);
        if (!operations.size) {
          pendingUserOperations.delete(userId);
        }
        callback();
      }
    };
    operations.add(abort);
    transaction.oncomplete = () => finish(resolve);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      finish(() =>
        reject(transaction.error ?? new DOMException("Transaction aborted")),
      );
  });
}

export async function persistCachedViewerId(
  viewerId: string,
  options: CancellationOptions = {},
): Promise<void> {
  const { signal } = options;
  if (!(viewerId && "indexedDB" in globalThis)) {
    throw new Error("Viewer identity storage is unavailable");
  }
  const clearLifetime = captureOfflineCacheUserClearLifetime(viewerId);
  const database = await openDatabase(signal);
  try {
    if (
      userClearOperations.has(viewerId) ||
      !isOfflineCacheUserClearLifetimeCurrent(viewerId, clearLifetime)
    ) {
      throw new Error("Offline cache is suspended");
    }
    await commitTransaction(
      database,
      METADATA_STORE,
      {
        key: VIEWER_ID_METADATA_KEY,
        value: viewerId,
      },
      viewerId,
      signal,
    );
  } finally {
    database.close();
  }
}

export async function readCachedViewerId(
  options: CancellationOptions = {},
): Promise<string | null> {
  const { signal } = options;
  if (!("indexedDB" in globalThis)) {
    throw new Error("Viewer identity storage is unavailable");
  }
  const database = await openDatabase(signal);
  try {
    throwIfAborted(signal);
    const record = await readMetadataRecord(database, VIEWER_ID_METADATA_KEY);
    throwIfAborted(signal);
    return record?.value || null;
  } finally {
    database.close();
  }
}

async function noteFile(
  userId: string,
  noteId: string,
  fileName: string,
  create = false,
  assertCurrent: () => void = () => undefined,
): Promise<FileSystemFileHandle> {
  assertCurrent();
  const root = await navigator.storage.getDirectory();
  assertCurrent();
  const appDirectory = await root.getDirectoryHandle(OPFS_ROOT, {
    create,
  });
  assertCurrent();
  const userDirectory = await appDirectory.getDirectoryHandle(
    encodePathPart(userId),
    { create },
  );
  assertCurrent();
  const notesDirectory = await userDirectory.getDirectoryHandle("notes", {
    create,
  });
  assertCurrent();
  const noteDirectory = await notesDirectory.getDirectoryHandle(
    encodePathPart(noteId),
    { create },
  );
  assertCurrent();
  const file = await noteDirectory.getFileHandle(fileName, { create });
  assertCurrent();
  return file;
}

async function writeMarkdown(
  userId: string,
  noteId: string,
  markdown: string,
  signal?: AbortSignal,
  assertCurrent: () => void = () => throwIfAborted(signal),
): Promise<string> {
  const fileName = `${crypto.randomUUID()}.md`;
  let writable: FileSystemWritableFileStream | undefined;
  let closed = false;
  const onAbort = () => {
    if (writable && !closed) {
      void writable.abort().catch(() => {
        // Preserve the caller's cancellation outcome.
      });
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const file = await noteFile(userId, noteId, fileName, true, assertCurrent);
    writable = await file.createWritable();
    assertCurrent();
    await writable.write(markdown);
    assertCurrent();
    await writable.close();
    closed = true;
    assertCurrent();
  } catch (error) {
    await writable?.abort().catch(() => {
      // Preserve the original write or cancellation error.
    });
    await removeUnreferencedNoteFile(userId, noteId, fileName);
    throw signal?.aborted ? signal.reason : error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
  return fileName;
}

async function removeUnreferencedNoteFile(
  userId: string,
  noteId: string,
  fileName: string,
): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const appDirectory = await root.getDirectoryHandle(OPFS_ROOT);
    const userDirectory = await appDirectory.getDirectoryHandle(
      encodePathPart(userId),
    );
    const notesDirectory = await userDirectory.getDirectoryHandle("notes");
    const noteDirectory = await notesDirectory.getDirectoryHandle(
      encodePathPart(noteId),
    );
    await noteDirectory.removeEntry(fileName);
  } catch {
    // Cleanup is best effort and must not mask the original error.
  }
}

export async function openOfflineCache(
  options: OpenOfflineCacheOptions & CancellationOptions,
): Promise<OfflineCache> {
  if (!options.userId) {
    throw new Error("A user ID is required");
  }
  if (!("indexedDB" in globalThis && navigator.storage?.getDirectory)) {
    throw new Error("Offline cache storage is unavailable");
  }

  const userId = options.userId;
  const clearLifetime = captureOfflineCacheUserClearLifetime(userId);
  const database = await openDatabase(options.signal);
  if (
    userClearOperations.has(userId) ||
    !isOfflineCacheUserClearLifetimeCurrent(userId, clearLifetime)
  ) {
    database.close();
    throw new Error("Offline cache is suspended");
  }
  let closed = false;

  const cache: OfflineCache = {
    beginNoteRead(id) {
      return currentNoteGeneration(userId, id);
    },
    async clearNoteDenial(id, orderingToken) {
      if (closed) {
        throw new Error("Offline cache is closed");
      }
      if (suspendedUsers.has(userId)) {
        throw new Error("Offline cache is suspended");
      }
      if (
        orderingToken !== undefined &&
        orderingToken !== currentNoteGeneration(userId, id)
      ) {
        return;
      }
      await deleteMetadata(database, deniedNoteKey(userId, id), userId);
    },
    close() {
      if (!closed) {
        closed = true;
        database.close();
      }
    },

    async denyFolder(id) {
      if (closed) {
        throw new Error("Offline cache is closed");
      }
      const lifetime = currentUserLifetime(userId);
      assertUserActive(userId, lifetime);
      await commitTransaction(
        database,
        METADATA_STORE,
        {
          key: deniedFolderKey(userId, id),
          value: id,
        },
        userId,
      );
      assertUserActive(userId, lifetime);
    },

    async denyNote(id, orderingToken) {
      if (closed) {
        throw new Error("Offline cache is closed");
      }
      if (suspendedUsers.has(userId)) {
        throw new Error("Offline cache is suspended");
      }
      const denialToken = orderingToken ?? enterOfflineNoteDenial(userId, id);
      if (denialToken !== currentNoteGeneration(userId, id)) {
        return;
      }
      try {
        await commitTransaction(
          database,
          METADATA_STORE,
          {
            key: deniedNoteKey(userId, id),
            value: "1",
          },
          userId,
        );
      } catch (error) {
        suspendOfflineCacheUser(userId);
        throw error;
      }
      try {
        const fileName = await removeCachedNote(database, userId, id);
        if (fileName) {
          await removeUnreferencedNoteFile(userId, id, fileName);
        }
      } catch {
        // The durable denial remains authoritative; cleanup is retryable.
      }
    },

    async getFolder(id) {
      if (closed) {
        throw new Error("Offline cache is closed");
      }
      const lifetime = currentUserLifetime(userId);
      if (isUserSuspended(userId)) {
        return null;
      }
      const record = await readFolderForRoute(database, userId, id);
      if (isUserSuspended(userId) || currentUserLifetime(userId) !== lifetime) {
        return null;
      }
      const deniedFolderIds = await readDeniedFolderIds(database, userId);
      if (isUserSuspended(userId) || currentUserLifetime(userId) !== lifetime) {
        return null;
      }
      if (!record) {
        return null;
      }
      const folder = projectDeniedFolder(record.folder, deniedFolderIds);
      return folder ? { cachedAt: record.cachedAt, folder } : null;
    },

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: lifetime and denial guards are intentionally explicit.
    async getNote(id) {
      if (closed) {
        throw new Error("Offline cache is closed");
      }
      const lifetime = currentUserLifetime(userId);
      const generation = currentNoteGeneration(userId, id);
      if (
        isUserSuspended(userId) ||
        (await readDeniedNote(database, userId, id))
      ) {
        return null;
      }
      if (
        isUserSuspended(userId) ||
        currentUserLifetime(userId) !== lifetime ||
        currentNoteGeneration(userId, id) !== generation
      ) {
        return null;
      }
      const record = await readRecord(database, noteKey(userId, id));
      if (
        !record ||
        isUserSuspended(userId) ||
        currentUserLifetime(userId) !== lifetime
      ) {
        return null;
      }

      try {
        const file = await noteFile(userId, id, record.fileName);
        const markdown = await (await file.getFile()).text();
        if (
          isUserSuspended(userId) ||
          currentUserLifetime(userId) !== lifetime ||
          currentNoteGeneration(userId, id) !== generation
        ) {
          return null;
        }
        return {
          cachedAt: record.cachedAt,
          note: { ...record.note, markdown } as Note,
        };
      } catch {
        // A missing or unreadable OPFS file is a cache miss, not a partial note.
        return null;
      }
    },

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: per-item denial and terminal publication guards are intentionally explicit.
    async getNoteList() {
      if (closed) {
        throw new Error("Offline cache is closed");
      }
      const lifetime = currentUserLifetime(userId);
      if (isUserSuspended(userId)) {
        return null;
      }
      const record = await readNoteListRecord(database, noteListKey(userId));
      if (
        !record ||
        isUserSuspended(userId) ||
        currentUserLifetime(userId) !== lifetime
      ) {
        return null;
      }
      const generations = new Map(
        record.notes.map((note) => [
          note.id,
          currentNoteGeneration(userId, note.id),
        ]),
      );
      const notes: NoteSummary[] = [];
      for (const note of record.notes) {
        if (!(await readDeniedNote(database, userId, note.id))) {
          if (
            isUserSuspended(userId) ||
            currentUserLifetime(userId) !== lifetime ||
            currentNoteGeneration(userId, note.id) !== generations.get(note.id)
          ) {
            return null;
          }
          notes.push(note);
        }
      }
      if (
        isUserSuspended(userId) ||
        currentUserLifetime(userId) !== lifetime ||
        record.notes.some(
          (note) =>
            currentNoteGeneration(userId, note.id) !== generations.get(note.id),
        )
      ) {
        return null;
      }
      return { cachedAt: record.cachedAt, notes };
    },

    async putFolder(folder, options = {}) {
      if (closed) {
        throw new Error("Offline cache is closed");
      }
      throwIfAborted(options.signal);
      const lifetime = currentUserLifetime(userId);
      assertUserActive(userId, lifetime);
      const cachedAt = Date.now();
      const record: FolderRecord = {
        cachedAt,
        folder,
        folderId: folder.id,
        key: folderKey(userId, folder.id),
        userId,
      };
      if (options.asDriveRoot) {
        await commitStoreRecords(
          database,
          [
            { record, storeName: FOLDER_STORE },
            {
              record: {
                key: driveRootMetadataKey(userId),
                value: JSON.stringify(folder.id),
              },
              storeName: METADATA_STORE,
            },
          ],
          userId,
          options.signal,
        );
      } else {
        await commitFolderRecord(database, record, userId, options.signal);
      }
    },

    async putNote(note, options = {}) {
      if (closed) {
        throw new Error("Offline cache is closed");
      }
      throwIfAborted(options.signal);
      const lifetime = currentUserLifetime(userId);
      assertUserActive(userId, lifetime);
      const orderingToken = options.orderingToken;
      if (
        orderingToken !== undefined &&
        orderingToken !== currentNoteGeneration(userId, note.id)
      ) {
        return;
      }
      // Register before the first path await and settle only after metadata and
      // cleanup reach their terminal outcome. Purge waits even for failed writes.
      let finishWrite!: () => void;
      const terminal = new Promise<void>((resolve) => {
        finishWrite = resolve;
      });
      const writes = pendingUserWrites.get(userId) ?? new Set<Promise<void>>();
      pendingUserWrites.set(userId, writes);
      writes.add(terminal);
      try {
        const fileName = await writeMarkdown(
          userId,
          note.id,
          note.markdown,
          options.signal,
          () => {
            throwIfAborted(options.signal);
            assertUserActive(userId, lifetime);
          },
        );
        const { markdown: _markdown, ...metadata } = note;
        try {
          assertUserActive(userId, lifetime);
          if (
            orderingToken !== undefined &&
            orderingToken !== currentNoteGeneration(userId, note.id)
          ) {
            await removeUnreferencedNoteFile(userId, note.id, fileName);
            return;
          }
          await commitTransaction(
            database,
            NOTE_STORE,
            {
              cachedAt: Date.now(),
              fileName,
              key: noteKey(userId, note.id),
              note: metadata,
              noteId: note.id,
              userId,
            },
            userId,
            options.signal,
          );
        } catch (error) {
          await removeUnreferencedNoteFile(userId, note.id, fileName);
          throw error;
        }
      } finally {
        writes.delete(terminal);
        if (!writes.size) {
          pendingUserWrites.delete(userId);
        }
        finishWrite();
      }
    },

    async putNoteList(notes, options = {}) {
      if (closed) {
        throw new Error("Offline cache is closed");
      }
      throwIfAborted(options.signal);
      const lifetime = currentUserLifetime(userId);
      assertUserActive(userId, lifetime);
      await commitNoteListRecord(
        database,
        {
          cachedAt: Date.now(),
          key: noteListKey(userId),
          notes,
          userId,
        },
        userId,
        options.signal,
      );
    },
  };
  const trackedClose = () => cache.close();
  const caches = openUserCaches.get(userId) ?? new Set<() => void>();
  openUserCaches.set(userId, caches);
  caches.add(trackedClose);
  const originalClose = cache.close;
  cache.close = () => {
    originalClose();
    caches.delete(trackedClose);
    if (!caches.size) {
      openUserCaches.delete(userId);
    }
  };
  return cache;
}

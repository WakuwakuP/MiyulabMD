import {
  awaitTx,
  DRAFT_LOCKS_STORE,
  DRAFTS_STORE,
  DRAFT_TOMBSTONES_STORE,
  openDb,
  readSessionRecord,
  SESSION_RECORD_KEY,
  SESSION_STORE,
} from "./offline-db.ts";
import type { LockEpoch, SessionEpoch } from "./offline-types.ts";

export type LocalDraftId = `local-${string}`;

export type LocalDraft = {
  kind: "draft";
  localId: LocalDraftId;
  ownerId: string;
  markdown: string;
  folder: string;
  folderId?: string;
  inheritAccess: true;
  createdAt: number;
  updatedAt: number;
  revision: number;
};

export type DraftLockRecord = {
  ownerId: string;
  localId: LocalDraftId;
  tabId: string;
  lockEpoch: LockEpoch;
  leaseExpiresAt: number;
};

export type SaveDraftInput = {
  ownerId: string;
  localId: LocalDraftId;
  markdown: string;
  folder: string;
  folderId?: string;
  revision: number;
  sessionEpoch: SessionEpoch;
  lockEpoch: LockEpoch;
};

export type SaveDraftResult =
  | { ok: true; draft: LocalDraft }
  | { ok: false; reason: "stale-revision" | "deleted" | "session-mismatch" | "lock-mismatch" | "storage-unavailable" };

type DraftListener = () => void;

const memoryDrafts = new Map<string, LocalDraft>();
const memoryTombstones = new Set<string>();
const draftListeners = new Set<DraftListener>();
const commitWaiters = new Map<string, Set<(draft: LocalDraft) => void>>();
let storageUnavailable = false;

function draftKey(ownerId: string, localId: string): string {
  return `${ownerId}\0${localId}`;
}

function notifyDraftListeners(): void {
  for (const listener of draftListeners) {
    listener();
  }
}

function resolveCommitWaiters(ownerId: string, localId: string, draft: LocalDraft): void {
  const key = draftKey(ownerId, localId);
  const waiters = commitWaiters.get(key);
  if (!waiters) {
    return;
  }
  for (const waiter of waiters) {
    waiter(draft);
  }
  commitWaiters.delete(key);
}

export function isDraftStorageUnavailable(): boolean {
  return storageUnavailable;
}

export function resetDraftStoreForTests(): void {
  memoryDrafts.clear();
  memoryTombstones.clear();
  draftListeners.clear();
  commitWaiters.clear();
  storageUnavailable = false;
}

export function subscribeDrafts(listener: DraftListener): () => void {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

export function createLocalDraftId(): LocalDraftId {
  return `local-${crypto.randomUUID()}` as LocalDraftId;
}

export async function getDraft(
  ownerId: string,
  localId: LocalDraftId,
): Promise<LocalDraft | null> {
  const key = draftKey(ownerId, localId);
  if (memoryTombstones.has(key)) {
    return null;
  }
  const db = await openDb();
  if (!db) {
    return memoryDrafts.get(key) ?? null;
  }
  try {
    const tx = db.transaction(DRAFTS_STORE, "readonly");
    const draft = await idbGet<LocalDraft>(tx.objectStore(DRAFTS_STORE), [
      ownerId,
      localId,
    ]);
    await awaitTx(tx);
    return draft ?? memoryDrafts.get(key) ?? null;
  } catch {
    return memoryDrafts.get(key) ?? null;
  }
}

export async function listDrafts(ownerId: string): Promise<LocalDraft[]> {
  const db = await openDb();
  const results: LocalDraft[] = [];
  const seen = new Set<string>();

  if (db) {
    try {
      const tx = db.transaction(DRAFTS_STORE, "readonly");
      const index = tx.objectStore(DRAFTS_STORE).index("ownerId");
      const request = index.openCursor(IDBKeyRange.only(ownerId));
      await new Promise<void>((resolve, reject) => {
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve();
            return;
          }
          const draft = cursor.value as LocalDraft;
          const key = draftKey(ownerId, draft.localId);
          if (!memoryTombstones.has(key)) {
            results.push(draft);
            seen.add(key);
          }
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
      await awaitTx(tx);
    } catch {
      // fall through to memory
    }
  }

  for (const [key, draft] of memoryDrafts) {
    if (draft.ownerId !== ownerId || memoryTombstones.has(key) || seen.has(key)) {
      continue;
    }
    results.push(draft);
  }

  return results.sort((a, b) => b.updatedAt - a.updatedAt);
}

async function readTombstone(
  db: IDBDatabase,
  ownerId: string,
  localId: LocalDraftId,
): Promise<boolean> {
  try {
    const tx = db.transaction(DRAFT_TOMBSTONES_STORE, "readonly");
    const tombstone = await idbGet<{ deletedAt: number }>(
      tx.objectStore(DRAFT_TOMBSTONES_STORE),
      [ownerId, localId],
    );
    await awaitTx(tx);
    return tombstone !== undefined;
  } catch {
    return memoryTombstones.has(draftKey(ownerId, localId));
  }
}

async function writeTombstone(
  db: IDBDatabase | null,
  ownerId: string,
  localId: LocalDraftId,
): Promise<void> {
  const key = draftKey(ownerId, localId);
  memoryTombstones.add(key);
  memoryDrafts.delete(key);
  if (!db) {
    return;
  }
  try {
    const tx = db.transaction(
      [DRAFTS_STORE, DRAFT_TOMBSTONES_STORE, DRAFT_LOCKS_STORE],
      "readwrite",
    );
    tx.objectStore(DRAFTS_STORE).delete([ownerId, localId]);
    tx.objectStore(DRAFT_LOCKS_STORE).delete([ownerId, localId]);
    tx.objectStore(DRAFT_TOMBSTONES_STORE).put(
      { deletedAt: Date.now() },
      [ownerId, localId],
    );
    await awaitTx(tx);
  } catch {
    // memory tombstone already recorded
  }
}

function idbGet<T>(
  store: IDBObjectStore | IDBIndex,
  key: IDBValidKey | IDBValidKey[],
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDraft(input: SaveDraftInput): Promise<SaveDraftResult> {
  const key = draftKey(input.ownerId, input.localId);
  if (memoryTombstones.has(key)) {
    return { ok: false, reason: "deleted" };
  }

  const db = await openDb();
  if (!db) {
    storageUnavailable = true;
    const existing = memoryDrafts.get(key);
    if (existing && input.revision <= existing.revision) {
      return { ok: false, reason: "stale-revision" };
    }
    const now = Date.now();
    const draft: LocalDraft = {
      createdAt: existing?.createdAt ?? now,
      folder: input.folder,
      folderId: input.folderId,
      inheritAccess: true,
      kind: "draft",
      localId: input.localId,
      markdown: input.markdown,
      ownerId: input.ownerId,
      revision: input.revision,
      updatedAt: now,
    };
    memoryDrafts.set(key, draft);
    notifyDraftListeners();
    resolveCommitWaiters(input.ownerId, input.localId, draft);
    return { ok: true, draft };
  }

  try {
    const tx = db.transaction(
      [DRAFTS_STORE, DRAFT_TOMBSTONES_STORE, DRAFT_LOCKS_STORE, SESSION_STORE],
      "readwrite",
    );
    const drafts = tx.objectStore(DRAFTS_STORE);
    const sessionStore = tx.objectStore(SESSION_STORE);
    const sessionReq = sessionStore.get(SESSION_RECORD_KEY);
    const sessionRecord = await new Promise<{ sessionEpoch?: SessionEpoch } | undefined>(
      (resolve, reject) => {
        sessionReq.onsuccess = () => resolve(sessionReq.result);
        sessionReq.onerror = () => reject(sessionReq.error);
      },
    );
    if (sessionRecord?.sessionEpoch !== input.sessionEpoch) {
      tx.abort();
      return { ok: false, reason: "session-mismatch" };
    }

    if (await readTombstoneInTx(tx, input.ownerId, input.localId)) {
      tx.abort();
      return { ok: false, reason: "deleted" };
    }

    const existing = await idbGet<LocalDraft>(drafts, [
      input.ownerId,
      input.localId,
    ]);
    if (existing && input.revision <= existing.revision) {
      tx.abort();
      return { ok: false, reason: "stale-revision" };
    }

    const lock = await idbGet<DraftLockRecord>(
      tx.objectStore(DRAFT_LOCKS_STORE),
      [input.ownerId, input.localId],
    );
    if (lock && lock.lockEpoch !== input.lockEpoch) {
      tx.abort();
      return { ok: false, reason: "lock-mismatch" };
    }

    const now = Date.now();
    const draft: LocalDraft = {
      createdAt: existing?.createdAt ?? now,
      folder: input.folder,
      folderId: input.folderId,
      inheritAccess: true,
      kind: "draft",
      localId: input.localId,
      markdown: input.markdown,
      ownerId: input.ownerId,
      revision: input.revision,
      updatedAt: now,
    };
    drafts.put(draft);
    await awaitTx(tx);
    memoryDrafts.set(key, draft);
    notifyDraftListeners();
    resolveCommitWaiters(input.ownerId, input.localId, draft);
    return { ok: true, draft };
  } catch {
    storageUnavailable = true;
    return { ok: false, reason: "storage-unavailable" };
  }
}

async function readTombstoneInTx(
  tx: IDBTransaction,
  ownerId: string,
  localId: LocalDraftId,
): Promise<boolean> {
  const tombstone = await idbGet<{ deletedAt: number }>(
    tx.objectStore(DRAFT_TOMBSTONES_STORE),
    [ownerId, localId],
  );
  return tombstone !== undefined || memoryTombstones.has(draftKey(ownerId, localId));
}

export async function deleteDraft(
  ownerId: string,
  localId: LocalDraftId,
): Promise<boolean> {
  const db = await openDb();
  await writeTombstone(db, ownerId, localId);
  notifyDraftListeners();
  return true;
}

export function awaitDraftCommitted(
  ownerId: string,
  localId: LocalDraftId,
  revision: number,
): Promise<LocalDraft> {
  const key = draftKey(ownerId, localId);
  const existing = memoryDrafts.get(key);
  if (existing && existing.revision >= revision) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const waiters = commitWaiters.get(key) ?? new Set();
    const waiter = (draft: LocalDraft) => {
      if (draft.revision >= revision) {
        waiters.delete(waiter);
        resolve(draft);
      }
    };
    waiters.add(waiter);
    commitWaiters.set(key, waiters);
    void getDraft(ownerId, localId).then((draft) => {
      if (draft && draft.revision >= revision) {
        waiters.delete(waiter);
        resolve(draft);
      }
    });
    setTimeout(() => {
      if (waiters.has(waiter)) {
        waiters.delete(waiter);
        reject(new Error("Draft commit timed out"));
      }
    }, 30_000);
  });
}

export async function readDraftLock(
  ownerId: string,
  localId: LocalDraftId,
): Promise<DraftLockRecord | null> {
  const db = await openDb();
  if (!db) {
    return null;
  }
  try {
    const tx = db.transaction(DRAFT_LOCKS_STORE, "readonly");
    const lock = await idbGet<DraftLockRecord>(
      tx.objectStore(DRAFT_LOCKS_STORE),
      [ownerId, localId],
    );
    await awaitTx(tx);
    return lock ?? null;
  } catch {
    return null;
  }
}

export async function writeDraftLock(
  record: DraftLockRecord,
): Promise<boolean> {
  const db = await openDb();
  if (!db) {
    return false;
  }
  try {
    const tx = db.transaction(DRAFT_LOCKS_STORE, "readwrite");
    tx.objectStore(DRAFT_LOCKS_STORE).put(record, [
      record.ownerId,
      record.localId,
    ]);
    await awaitTx(tx);
    return true;
  } catch {
    return false;
  }
}

export async function removeDraftLock(
  ownerId: string,
  localId: LocalDraftId,
): Promise<void> {
  const db = await openDb();
  if (!db) {
    return;
  }
  try {
    const tx = db.transaction(DRAFT_LOCKS_STORE, "readwrite");
    tx.objectStore(DRAFT_LOCKS_STORE).delete([ownerId, localId]);
    await awaitTx(tx);
  } catch {
    // ignore
  }
}

/** Initial draft insert (creation path). */
export async function insertDraft(draft: LocalDraft): Promise<boolean> {
  const db = await openDb();
  const key = draftKey(draft.ownerId, draft.localId);
  if (memoryTombstones.has(key)) {
    return false;
  }
  if (!db) {
    storageUnavailable = true;
    memoryDrafts.set(key, draft);
    notifyDraftListeners();
    return true;
  }
  try {
    const tx = db.transaction([DRAFTS_STORE, DRAFT_TOMBSTONES_STORE], "readwrite");
    if (await readTombstoneInTx(tx, draft.ownerId, draft.localId)) {
      tx.abort();
      return false;
    }
    const existing = await idbGet<LocalDraft>(tx.objectStore(DRAFTS_STORE), [
      draft.ownerId,
      draft.localId,
    ]);
    if (existing) {
      tx.abort();
      return false;
    }
    tx.objectStore(DRAFTS_STORE).put(draft);
    await awaitTx(tx);
    memoryDrafts.set(key, draft);
    notifyDraftListeners();
    return true;
  } catch {
    storageUnavailable = true;
    memoryDrafts.set(key, draft);
    notifyDraftListeners();
    return true;
  }
}

export async function hydrateDraftStorageEpoch(): Promise<void> {
  await readSessionRecord();
}

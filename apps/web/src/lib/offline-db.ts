import type { AccountScope, SessionEpoch } from "./offline-types.ts";

export const OFFLINE_DB_NAME = "miyulabmd-offline";
export const OFFLINE_DB_VERSION = 3;

export const SESSION_STORE = "session";
export const SESSION_RECORD_KEY = "current";
export const NOTES_STORE = "notes";
export const LISTS_STORE = "lists";
export const DRAFTS_STORE = "drafts";
export const DRAFT_LOCKS_STORE = "draft-locks";
export const DRAFT_TOMBSTONES_STORE = "draft-tombstones";
export const DRAFT_JOURNAL_STORE = "draft-journal";
export const DRAFT_PROMOTIONS_STORE = "draft-promotions";

/** Persisted session metadata for offline-known and coordinator teardown. */
export type OfflineSessionRecord = {
  scope: AccountScope | null;
  lastConfirmedUser: {
    id: string;
    email: string;
    displayName: string | null;
  } | null;
  confirmedAt: number | null;
  offlineReadable: boolean;
  sessionEpoch: SessionEpoch;
  pendingCleanup?: boolean;
};

export type OfflineDbConfig = {
  indexedDB?: IDBFactory;
  /** How long to wait on `blocked` before giving up (default 250ms). */
  blockedTimeoutMs?: number;
};

let config: OfflineDbConfig = {};
let dbPromise: Promise<IDBDatabase | null> | null = null;
let dbInstance: IDBDatabase | null = null;
let dbBlocked = false;

function idb(): IDBFactory | undefined {
  return config.indexedDB ?? globalThis.indexedDB;
}

/** Inject IndexedDB (tests) and tune blocked timeout. */
export function configureOfflineDb(next: OfflineDbConfig): void {
  config = next;
  closeOfflineDb();
}

export function resetOfflineDbForTests(): void {
  config = {};
  closeOfflineDb();
  dbBlocked = false;
}

export function isOfflineDbBlocked(): boolean {
  return dbBlocked;
}

export function closeOfflineDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  dbPromise = null;
}

/** Server-backed ids only — `local-*` drafts belong in drafts store (#96). */
export function isPersistableRemoteId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && !id.startsWith("local-");
}

export function assertPersistableRemoteId(id: string): void {
  if (!isPersistableRemoteId(id)) {
    throw new Error(`Refusing to persist local draft id in notes/lists: ${id}`);
  }
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "UnknownError")
  );
}

function createStores(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(NOTES_STORE)) {
    const notes = db.createObjectStore(NOTES_STORE, {
      keyPath: ["scope", "id"],
    });
    notes.createIndex("scopeShortId", ["scope", "shortId"], { unique: true });
  }
  if (!db.objectStoreNames.contains(LISTS_STORE)) {
    db.createObjectStore(LISTS_STORE, { keyPath: ["scope", "kind", "key"] });
  }
  if (!db.objectStoreNames.contains(SESSION_STORE)) {
    db.createObjectStore(SESSION_STORE);
  }
  if (!db.objectStoreNames.contains(DRAFTS_STORE)) {
    const drafts = db.createObjectStore(DRAFTS_STORE, {
      keyPath: ["ownerId", "localId"],
    });
    drafts.createIndex("ownerId", "ownerId", { unique: false });
  }
  if (!db.objectStoreNames.contains(DRAFT_LOCKS_STORE)) {
    db.createObjectStore(DRAFT_LOCKS_STORE, {
      keyPath: ["ownerId", "localId"],
    });
  }
  if (!db.objectStoreNames.contains(DRAFT_TOMBSTONES_STORE)) {
    db.createObjectStore(DRAFT_TOMBSTONES_STORE, {
      keyPath: ["ownerId", "localId"],
    });
  }
  if (!db.objectStoreNames.contains(DRAFT_JOURNAL_STORE)) {
    const journal = db.createObjectStore(DRAFT_JOURNAL_STORE, {
      keyPath: ["ownerId", "localId"],
    });
    journal.createIndex("ownerId", "ownerId", { unique: false });
  }
  if (!db.objectStoreNames.contains(DRAFT_PROMOTIONS_STORE)) {
    db.createObjectStore(DRAFT_PROMOTIONS_STORE, {
      keyPath: ["ownerId", "localId"],
    });
  }
}

function attachVersionChangeHandler(db: IDBDatabase): void {
  db.onversionchange = () => {
    db.close();
    if (dbInstance === db) {
      dbInstance = null;
      dbPromise = null;
    }
  };
}

function openDbInternal(): Promise<IDBDatabase | null> {
  const factory = idb();
  if (!factory) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    dbBlocked = false;
    let settled = false;
    const finish = (value: IDBDatabase | null) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    let request: IDBOpenDBRequest;
    try {
      request = factory.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    } catch {
      finish(null);
      return;
    }

    const blockedTimeoutMs = config.blockedTimeoutMs ?? 250;
    let blockedTimer: ReturnType<typeof setTimeout> | undefined;

    request.onblocked = () => {
      dbBlocked = true;
      blockedTimer = setTimeout(() => {
        finish(null);
      }, blockedTimeoutMs);
    };

    request.onupgradeneeded = (event) => {
      createStores((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = () => {
      if (blockedTimer) {
        clearTimeout(blockedTimer);
      }
      finish(null);
    };

    request.onsuccess = () => {
      if (blockedTimer) {
        clearTimeout(blockedTimer);
      }
      dbBlocked = false;
      const db = request.result;
      attachVersionChangeHandler(db);
      dbInstance = db;
      finish(db);
    };
  });
}

/** Single shared IndexedDB connection. Returns null on failure (memory fallback). */
export function openDb(): Promise<IDBDatabase | null> {
  if (dbInstance) {
    return Promise.resolve(dbInstance);
  }
  if (!dbPromise) {
    dbPromise = openDbInternal().catch(() => null);
  }
  return dbPromise;
}

/** Resolve when the transaction completes; reject on error/abort. */
export function awaitTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () =>
      reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function readSessionRecord(): Promise<OfflineSessionRecord | null> {
  const db = await openDb();
  if (!db) {
    return null;
  }
  try {
    const tx = db.transaction(SESSION_STORE, "readonly");
    const store = tx.objectStore(SESSION_STORE);
    const request = store.get(SESSION_RECORD_KEY);
    const record = await new Promise<OfflineSessionRecord | undefined>(
      (resolve, reject) => {
        request.onsuccess = () =>
          resolve(request.result as OfflineSessionRecord | undefined);
        request.onerror = () => reject(request.error);
      },
    );
    await awaitTx(tx);
    return record ?? null;
  } catch {
    return null;
  }
}

export async function writeSessionRecord(
  record: OfflineSessionRecord,
): Promise<boolean> {
  const db = await openDb();
  if (!db) {
    return false;
  }
  try {
    const tx = db.transaction(SESSION_STORE, "readwrite");
    tx.objectStore(SESSION_STORE).put(record, SESSION_RECORD_KEY);
    await awaitTx(tx);
    return true;
  } catch (error) {
    if (isQuotaError(error)) {
      return false;
    }
    return false;
  }
}

async function deleteAllInStore(
  db: IDBDatabase,
  storeName: string,
  scope: AccountScope,
): Promise<void> {
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  const request = store.openCursor();
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const key = cursor.key as unknown[];
      if (Array.isArray(key) && key[0] === scope) {
        cursor.delete();
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
  await awaitTx(tx);
}

/** Remove persisted notes/lists for a scope (coordinator teardown; persist in slice C). */
export async function deleteScopeData(scope: AccountScope): Promise<boolean> {
  const db = await openDb();
  if (!db) {
    return false;
  }
  try {
    await deleteAllInStore(db, NOTES_STORE, scope);
    await deleteAllInStore(db, LISTS_STORE, scope);
    return true;
  } catch {
    return false;
  }
}

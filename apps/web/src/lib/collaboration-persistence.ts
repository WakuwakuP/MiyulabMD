import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";
import { registerPersistenceCleanup } from "./offline-session.ts";
import type { AccountScope, RequestGeneration } from "./offline-types.ts";

/** y-indexeddb 9.0.12 internal schema — keep inside this adapter. */
const YJS_UPDATES_STORE = "updates";
const YJS_CUSTOM_STORE = "custom";

export const CATALOG_DB_NAME = "miyulabmd-yjs-catalog-v1";
export const CATALOG_STORE = "entries";
const CATALOG_VERSION = 1;

const YJS_DB_PREFIX = "miyulabmd-yjs-v1";
const CHECKPOINT_META_KEY = "miyulabmd:checkpointMeta";

const CHECKPOINT_MAX_COUNT = 64;
const CHECKPOINT_MAX_BYTES = 4 * 1024 * 1024;

const INVALID_GENERATION = 0 as RequestGeneration;

export type CatalogEntry = {
  scope: AccountScope;
  noteId: string;
  dbName: string;
  generation: RequestGeneration;
  pendingDelete: boolean;
};

export type NotePersistence = {
  /** Resolves when IndexedDB load into the doc has finished (not remote sync). */
  whenSynced: Promise<void>;
  /** Append a merged state update; resolves true only after the IDB tx completes. */
  checkpoint(): Promise<boolean>;
  /** Closes the IDB connection without deleting stored data. */
  destroy(): Promise<void>;
};

export type OpenNotePersistenceInput = {
  scope: AccountScope;
  noteId: string;
  doc: Y.Doc;
  generation: RequestGeneration;
};

type CheckpointMeta = {
  checkpointKeys: number[];
  checkpointBytes: number;
  lastStateVector: string;
};

type PersistenceConfig = {
  indexedDB?: IDBFactory;
};

let config: PersistenceConfig = {};
const openByDbName = new Map<string, IndexeddbPersistence>();
let cleanupInstalled = false;
let previousGlobalIndexedDb: IDBFactory | undefined;

function idbFactory(): IDBFactory | undefined {
  return config.indexedDB ?? globalThis.indexedDB;
}

/** Inject IndexedDB (tests). Also patches globalThis for y-indexeddb / lib0. */
export function configureCollaborationPersistence(
  next: PersistenceConfig,
): void {
  config = next;
  if (next.indexedDB) {
    previousGlobalIndexedDb = globalThis.indexedDB;
    globalThis.indexedDB = next.indexedDB;
  }
}

/** Test-only reset. */
export function resetCollaborationPersistenceForTests(): void {
  if (previousGlobalIndexedDb !== undefined) {
    globalThis.indexedDB = previousGlobalIndexedDb;
    previousGlobalIndexedDb = undefined;
  }
  config = {};
  openByDbName.clear();
  cleanupInstalled = false;
}

function encodeScopeForDbName(scope: AccountScope): string {
  return encodeURIComponent(scope);
}

/** Canonical note DB name — always uses GET UUID, never shortId. */
export function buildNoteDbName(scope: AccountScope, noteId: string): string {
  return `${YJS_DB_PREFIX}:${encodeScopeForDbName(scope)}:${noteId}`;
}

function catalogKey(scope: AccountScope, noteId: string): string {
  return `${scope}\0${noteId}`;
}

function emptyCheckpointMeta(): CheckpointMeta {
  return {
    checkpointBytes: 0,
    checkpointKeys: [],
    lastStateVector: "",
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function stateVectorBase64(doc: Y.Doc): string {
  return bytesToBase64(Y.encodeStateVector(doc));
}

function openCatalogDb(): Promise<IDBDatabase | null> {
  const factory = idbFactory();
  if (!factory) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const request = factory.open(CATALOG_DB_NAME, CATALOG_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CATALOG_STORE)) {
        db.createObjectStore(CATALOG_STORE);
      }
    };
    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
      };
      resolve(db);
    };
  });
}

async function putCatalogEntry(entry: CatalogEntry): Promise<boolean> {
  const db = await openCatalogDb();
  if (!db) {
    return false;
  }
  return await new Promise((resolve) => {
    const tx = db.transaction(CATALOG_STORE, "readwrite");
    tx.objectStore(CATALOG_STORE).put(
      entry,
      catalogKey(entry.scope, entry.noteId),
    );
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      resolve(false);
    };
    tx.onabort = () => {
      db.close();
      resolve(false);
    };
  });
}

async function readCatalogEntry(
  scope: AccountScope,
  noteId: string,
): Promise<CatalogEntry | null> {
  const db = await openCatalogDb();
  if (!db) {
    return null;
  }
  return await new Promise((resolve) => {
    const tx = db.transaction(CATALOG_STORE, "readonly");
    const request = tx
      .objectStore(CATALOG_STORE)
      .get(catalogKey(scope, noteId));
    request.onsuccess = () => {
      resolve((request.result as CatalogEntry | undefined) ?? null);
    };
    request.onerror = () => resolve(null);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      resolve(null);
    };
  });
}

async function removeCatalogEntry(
  scope: AccountScope,
  noteId: string,
): Promise<void> {
  const db = await openCatalogDb();
  if (!db) {
    return;
  }
  await new Promise<void>((resolve) => {
    const tx = db.transaction(CATALOG_STORE, "readwrite");
    tx.objectStore(CATALOG_STORE).delete(catalogKey(scope, noteId));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      resolve();
    };
  });
}

export async function listCatalog(): Promise<CatalogEntry[]> {
  const db = await openCatalogDb();
  if (!db) {
    return [];
  }
  return await new Promise((resolve) => {
    const tx = db.transaction(CATALOG_STORE, "readonly");
    const request = tx.objectStore(CATALOG_STORE).getAll();
    request.onsuccess = () => {
      resolve((request.result as CatalogEntry[]) ?? []);
    };
    request.onerror = () => resolve([]);
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      resolve([]);
    };
  });
}

async function invalidateCatalogGeneration(
  scope: AccountScope,
  noteId: string,
): Promise<void> {
  const entry = await readCatalogEntry(scope, noteId);
  if (!entry) {
    return;
  }
  await putCatalogEntry({
    ...entry,
    generation: INVALID_GENERATION,
  });
}

async function markCatalogPendingDelete(
  scope: AccountScope,
  noteId: string,
): Promise<void> {
  const entry = await readCatalogEntry(scope, noteId);
  if (!entry) {
    return;
  }
  await putCatalogEntry({ ...entry, pendingDelete: true });
}

function waitForDeleteDatabase(dbName: string): Promise<boolean> {
  const factory = idbFactory();
  if (!factory) {
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    const request = factory.deleteDatabase(dbName);
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
    request.onblocked = () => resolve(false);
  });
}

async function destroyOpenPersistence(dbName: string): Promise<void> {
  const open = openByDbName.get(dbName);
  if (!open) {
    return;
  }
  openByDbName.delete(dbName);
  await open.destroy();
}

function trackPersistence(
  dbName: string,
  persistence: IndexeddbPersistence,
): void {
  openByDbName.set(dbName, persistence);
}

function untrackPersistence(dbName: string): void {
  openByDbName.delete(dbName);
}

export async function clearDocument(dbName: string): Promise<boolean> {
  await destroyOpenPersistence(dbName);
  return await waitForDeleteDatabase(dbName);
}

async function deleteNoteDb(
  scope: AccountScope,
  noteId: string,
  reason: string,
): Promise<boolean> {
  void reason;
  const entry = await readCatalogEntry(scope, noteId);
  if (!entry) {
    return true;
  }
  await invalidateCatalogGeneration(scope, noteId);
  await markCatalogPendingDelete(scope, noteId);
  await destroyOpenPersistence(entry.dbName);
  const deleted = await waitForDeleteDatabase(entry.dbName);
  if (deleted) {
    await removeCatalogEntry(scope, noteId);
    return true;
  }
  return false;
}

export async function deleteNotePersistence(
  scope: AccountScope,
  noteIds: string[],
): Promise<void> {
  for (const noteId of noteIds) {
    await deleteNoteDb(scope, noteId, "delete-note");
  }
}

export async function deleteScopePersistence(
  scope: AccountScope,
): Promise<void> {
  const entries = await listCatalog();
  for (const entry of entries) {
    if (entry.scope === scope) {
      await deleteNoteDb(scope, entry.noteId, "delete-scope");
    }
  }
}

export async function retryPendingDeletes(): Promise<void> {
  const entries = await listCatalog();
  for (const entry of entries) {
    if (!entry.pendingDelete) {
      continue;
    }
    await destroyOpenPersistence(entry.dbName);
    const deleted = await waitForDeleteDatabase(entry.dbName);
    if (deleted) {
      await removeCatalogEntry(entry.scope, entry.noteId);
    }
  }
}

function openNoteDatabase(dbName: string): Promise<IDBDatabase | null> {
  const factory = idbFactory();
  if (!factory) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    const request = factory.open(dbName);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(YJS_UPDATES_STORE)) {
        db.createObjectStore(YJS_UPDATES_STORE, { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(YJS_CUSTOM_STORE)) {
        db.createObjectStore(YJS_CUSTOM_STORE);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
      };
      resolve(db);
    };
  });
}

function readCheckpointMetaInTx(
  custom: IDBObjectStore,
): Promise<CheckpointMeta> {
  return new Promise((resolve) => {
    const request = custom.get(CHECKPOINT_META_KEY);
    request.onsuccess = () => {
      resolve(
        (request.result as CheckpointMeta | undefined) ?? emptyCheckpointMeta(),
      );
    };
    request.onerror = () => resolve(emptyCheckpointMeta());
  });
}

function compactCheckpointKeysInTx(
  updates: IDBObjectStore,
  custom: IDBObjectStore,
  meta: CheckpointMeta,
): void {
  const keys = meta.checkpointKeys;
  if (keys.length === 0) {
    custom.put(meta, CHECKPOINT_META_KEY);
    return;
  }

  const payloads: Uint8Array[] = [];
  let loaded = 0;

  for (const key of keys) {
    const request = updates.get(key);
    request.onsuccess = () => {
      const value = request.result as Uint8Array | undefined;
      if (value) {
        payloads.push(value);
      }
      loaded += 1;
      if (loaded === keys.length) {
        const merged =
          payloads.length > 0 ? Y.mergeUpdates(payloads) : new Uint8Array();
        const addRequest = updates.add(merged);
        addRequest.onsuccess = () => {
          const newKey = addRequest.result as number;
          for (const deleteKey of keys) {
            updates.delete(deleteKey);
          }
          custom.put(
            {
              checkpointBytes: merged.byteLength,
              checkpointKeys: [newKey],
              lastStateVector: meta.lastStateVector,
            },
            CHECKPOINT_META_KEY,
          );
        };
      }
    };
  }
}

async function runCheckpoint(dbName: string, doc: Y.Doc): Promise<boolean> {
  const db = await openNoteDatabase(dbName);
  if (!db) {
    return false;
  }

  const stateVector = stateVectorBase64(doc);
  const update = Y.encodeStateAsUpdate(doc);

  return await new Promise((resolve) => {
    const tx = db.transaction(
      [YJS_UPDATES_STORE, YJS_CUSTOM_STORE],
      "readwrite",
    );
    const updates = tx.objectStore(YJS_UPDATES_STORE);
    const custom = tx.objectStore(YJS_CUSTOM_STORE);
    let failed = false;

    const metaRequest = custom.get(CHECKPOINT_META_KEY);
    metaRequest.onsuccess = () => {
      const meta =
        (metaRequest.result as CheckpointMeta | undefined) ??
        emptyCheckpointMeta();
      if (meta.lastStateVector === stateVector) {
        return;
      }

      const addRequest = updates.add(update);
      addRequest.onsuccess = () => {
        const addedKey = addRequest.result as number;
        const nextMeta: CheckpointMeta = {
          checkpointBytes: meta.checkpointBytes + update.byteLength,
          checkpointKeys: [...meta.checkpointKeys, addedKey],
          lastStateVector: stateVector,
        };
        if (
          nextMeta.checkpointKeys.length >= CHECKPOINT_MAX_COUNT ||
          nextMeta.checkpointBytes >= CHECKPOINT_MAX_BYTES
        ) {
          compactCheckpointKeysInTx(updates, custom, nextMeta);
        } else {
          custom.put(nextMeta, CHECKPOINT_META_KEY);
        }
      };
      addRequest.onerror = () => {
        failed = true;
      };
    };
    metaRequest.onerror = () => {
      failed = true;
    };

    tx.oncomplete = () => {
      db.close();
      resolve(!failed);
    };
    tx.onerror = () => {
      db.close();
      resolve(false);
    };
    tx.onabort = () => {
      db.close();
      resolve(false);
    };
  });
}

async function loadDocFromIdb(
  dbName: string,
  generation: RequestGeneration,
  scope: AccountScope,
  noteId: string,
): Promise<Y.Doc | null> {
  const loadDoc = new Y.Doc();
  let loader: IndexeddbPersistence;
  try {
    loader = new IndexeddbPersistence(dbName, loadDoc);
    trackPersistence(dbName, loader);
  } catch {
    loadDoc.destroy();
    return null;
  }

  try {
    await loader.whenSynced;
  } catch {
    untrackPersistence(dbName);
    await loader.destroy();
    loadDoc.destroy();
    return null;
  }

  const entry = await readCatalogEntry(scope, noteId);
  if (!entry || entry.pendingDelete || entry.generation !== generation) {
    untrackPersistence(dbName);
    await loader.destroy();
    loadDoc.destroy();
    return null;
  }

  untrackPersistence(dbName);
  await loader.destroy();
  return loadDoc;
}

export async function openNotePersistence(
  input: OpenNotePersistenceInput,
): Promise<NotePersistence | null> {
  const { scope, noteId, doc, generation } = input;
  const dbName = buildNoteDbName(scope, noteId);

  const existing = await readCatalogEntry(scope, noteId);
  if (existing?.pendingDelete) {
    return null;
  }
  if (existing && existing.generation > generation) {
    return null;
  }

  const registered = await putCatalogEntry({
    dbName,
    generation,
    noteId,
    pendingDelete: false,
    scope,
  });
  if (!registered) {
    return null;
  }

  const beforeOpen = await readCatalogEntry(scope, noteId);
  if (!beforeOpen || beforeOpen.generation !== generation) {
    return null;
  }

  const loadDoc = await loadDocFromIdb(dbName, generation, scope, noteId);
  if (!loadDoc) {
    return null;
  }

  Y.applyUpdate(doc, Y.encodeStateAsUpdate(loadDoc));
  loadDoc.destroy();

  let live: IndexeddbPersistence;
  try {
    live = new IndexeddbPersistence(dbName, doc);
    trackPersistence(dbName, live);
  } catch {
    return null;
  }

  try {
    await live.whenSynced;
  } catch {
    untrackPersistence(dbName);
    await live.destroy();
    return null;
  }

  const afterOpen = await readCatalogEntry(scope, noteId);
  if (
    !afterOpen ||
    afterOpen.pendingDelete ||
    afterOpen.generation !== generation
  ) {
    untrackPersistence(dbName);
    await live.destroy();
    return null;
  }

  return {
    checkpoint: () => runCheckpoint(dbName, doc),
    destroy: async () => {
      untrackPersistence(dbName);
      await live.destroy();
    },
    whenSynced: live.whenSynced.then(() => undefined),
  };
}

/** Register Yjs persistence cleanup with the offline session coordinator (once). */
export function installYjsPersistenceCleanup(): void {
  if (cleanupInstalled) {
    return;
  }
  cleanupInstalled = true;
  registerPersistenceCleanup({
    removeNotePersistence: (scope, ids, reason) =>
      deleteNotePersistence(scope, ids).then(() => {
        void reason;
      }),
    removeScopePersistence: (scope, reason) =>
      deleteScopePersistence(scope).then(() => {
        void reason;
      }),
  });
}

/** Test-only: inspect note DB object stores (Yjs updates only). */
export async function __testOpenNoteDb(
  dbName: string,
): Promise<IDBDatabase | null> {
  return await openNoteDatabase(dbName);
}

/** Test-only: read checkpoint meta from a note DB. */
export async function __testReadCheckpointMeta(
  dbName: string,
): Promise<CheckpointMeta> {
  const db = await openNoteDatabase(dbName);
  if (!db) {
    return emptyCheckpointMeta();
  }
  const meta = await new Promise<CheckpointMeta>((resolve) => {
    const tx = db.transaction(YJS_CUSTOM_STORE, "readonly");
    void readCheckpointMetaInTx(tx.objectStore(YJS_CUSTOM_STORE)).then(resolve);
    tx.oncomplete = () => db.close();
  });
  return meta;
}

/** Test-only: mark catalog pendingDelete without deleting (blocked-delete tests). */
export async function __testMarkCatalogPendingDelete(
  scope: AccountScope,
  noteId: string,
): Promise<void> {
  await markCatalogPendingDelete(scope, noteId);
}

/** Test-only: whether a database name still exists. */
export async function __testDatabaseExists(dbName: string): Promise<boolean> {
  const factory = idbFactory();
  if (!factory?.databases) {
    return false;
  }
  const dbs = await factory.databases();
  return dbs.some((entry) => entry.name === dbName);
}

/** Test-only: override catalog generation (stale-open tests). */
export async function __testUpdateCatalogGeneration(
  scope: AccountScope,
  noteId: string,
  generation: RequestGeneration,
): Promise<void> {
  const entry = await readCatalogEntry(scope, noteId);
  if (!entry) {
    return;
  }
  await putCatalogEntry({ ...entry, generation });
}

/** Test-only: count rows in updates store. */
export async function __testCountUpdates(dbName: string): Promise<number> {
  const db = await openNoteDatabase(dbName);
  if (!db) {
    return 0;
  }
  return await new Promise((resolve) => {
    const tx = db.transaction(YJS_UPDATES_STORE, "readonly");
    const request = tx.objectStore(YJS_UPDATES_STORE).count();
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => resolve(0);
    tx.oncomplete = () => db.close();
  });
}

import type { FolderAccess, Note, NoteSummary } from "@miyulabmd/shared";
import {
  type CachedFolder,
  type CachedNote,
  type CachedNotesList,
  cachedToFolder,
  folderToCached,
  listRecordToSummaries,
  noteToCached,
  sanitizeCachedFolder,
  sanitizeCachedNote,
  summariesToListRecord,
} from "./offline-cache-types.ts";
import {
  assertPersistableRemoteId,
  awaitTx,
  isPersistableRemoteId,
  LISTS_STORE,
  NOTES_STORE,
  openDb,
  SESSION_RECORD_KEY,
  SESSION_STORE,
} from "./offline-db.ts";
import type { AccountScope, SessionEpoch } from "./offline-types.ts";

function folderListKey(id?: string | null): string {
  return id ?? "__root__";
}

async function readSessionEpochInTx(
  tx: IDBTransaction,
): Promise<SessionEpoch | null> {
  const store = tx.objectStore(SESSION_STORE);
  const request = store.get(SESSION_RECORD_KEY);
  const record = await new Promise<{ sessionEpoch?: SessionEpoch } | undefined>(
    (resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    },
  );
  return record?.sessionEpoch ?? null;
}

async function assertSessionEpoch(
  tx: IDBTransaction,
  expectedEpoch: SessionEpoch,
): Promise<boolean> {
  const current = await readSessionEpochInTx(tx);
  if (current !== expectedEpoch) {
    tx.abort();
    return false;
  }
  return true;
}

export async function readCachedNote(
  scope: AccountScope,
  id: string,
): Promise<CachedNote | null> {
  const db = await openDb();
  if (!db) {
    return null;
  }
  try {
    const tx = db.transaction(NOTES_STORE, "readonly");
    const store = tx.objectStore(NOTES_STORE);
    const byId = await idbGet<CachedNote>(store, [scope, id]);
    if (byId) {
      await awaitTx(tx);
      return sanitizeCachedNote(byId);
    }
    const index = store.index("scopeShortId");
    const byShort = await idbGet<CachedNote>(index, [scope, id]);
    await awaitTx(tx);
    return byShort ? sanitizeCachedNote(byShort) : null;
  } catch {
    return null;
  }
}

export async function hasCachedNoteBody(
  scope: AccountScope,
  id: string,
): Promise<boolean> {
  const cached = await readCachedNote(scope, id);
  return cached !== null;
}

export async function readCachedNotesList(
  scope: AccountScope,
): Promise<NoteSummary[] | null> {
  const db = await openDb();
  if (!db) {
    return null;
  }
  try {
    const tx = db.transaction(LISTS_STORE, "readonly");
    const store = tx.objectStore(LISTS_STORE);
    const raw = await idbGet<CachedNotesList>(store, [scope, "notes", "notes"]);
    await awaitTx(tx);
    if (!raw?.summaries) {
      return null;
    }
    return listRecordToSummaries(raw);
  } catch {
    return null;
  }
}

export async function readCachedFolder(
  scope: AccountScope,
  folderId?: string | null,
): Promise<FolderAccess | null> {
  const db = await openDb();
  if (!db) {
    return null;
  }
  const key = folderListKey(folderId);
  try {
    const tx = db.transaction(LISTS_STORE, "readonly");
    const store = tx.objectStore(LISTS_STORE);
    const raw = await idbGet<CachedFolder>(store, [scope, "folder", key]);
    await awaitTx(tx);
    const sanitized = raw ? sanitizeCachedFolder(raw) : null;
    return sanitized ? cachedToFolder(sanitized) : null;
  } catch {
    return null;
  }
}

export async function writeCachedNote(
  note: Note,
  scope: AccountScope,
  sessionEpoch: SessionEpoch,
): Promise<boolean> {
  if (!isPersistableRemoteId(note.id)) {
    return false;
  }
  assertPersistableRemoteId(note.id);
  const db = await openDb();
  if (!db) {
    return false;
  }
  try {
    const tx = db.transaction([SESSION_STORE, NOTES_STORE], "readwrite");
    if (!(await assertSessionEpoch(tx, sessionEpoch))) {
      return false;
    }
    const record = noteToCached(note, scope, sessionEpoch);
    tx.objectStore(NOTES_STORE).put(record);
    await awaitTx(tx);
    return true;
  } catch {
    return false;
  }
}

export async function writeCachedNotesList(
  summaries: NoteSummary[],
  scope: AccountScope,
  sessionEpoch: SessionEpoch,
): Promise<boolean> {
  const db = await openDb();
  if (!db) {
    return false;
  }
  try {
    const tx = db.transaction([SESSION_STORE, LISTS_STORE], "readwrite");
    if (!(await assertSessionEpoch(tx, sessionEpoch))) {
      return false;
    }
    const record = summariesToListRecord(summaries, scope, sessionEpoch);
    tx.objectStore(LISTS_STORE).put(record);
    await awaitTx(tx);
    return true;
  } catch {
    return false;
  }
}

export async function writeCachedFolder(
  folder: FolderAccess,
  scope: AccountScope,
  sessionEpoch: SessionEpoch,
  folderId?: string | null,
): Promise<boolean> {
  const db = await openDb();
  if (!db) {
    return false;
  }
  const key = folderListKey(folderId ?? folder.id);
  try {
    const tx = db.transaction([SESSION_STORE, LISTS_STORE], "readwrite");
    if (!(await assertSessionEpoch(tx, sessionEpoch))) {
      return false;
    }
    const record = folderToCached(folder, scope, key, sessionEpoch);
    tx.objectStore(LISTS_STORE).put(record);
    await awaitTx(tx);
    return true;
  } catch {
    return false;
  }
}

function summaryMatchesEvict(
  summary: CachedNotesList["summaries"][number],
  resolvedIds: Set<string>,
): boolean {
  return (
    resolvedIds.has(summary.id) ||
    Boolean(summary.shortId && resolvedIds.has(summary.shortId))
  );
}

async function resolveEvictIds(
  scope: AccountScope,
  ids: string[],
): Promise<Set<string>> {
  const resolvedIds = new Set<string>();
  for (const id of ids) {
    const cached = await readCachedNote(scope, id);
    if (cached) {
      resolvedIds.add(cached.id);
      if (cached.shortId) {
        resolvedIds.add(cached.shortId);
      }
    } else {
      resolvedIds.add(id);
    }
  }
  return resolvedIds;
}

async function pruneNotesListStore(
  listsStore: IDBObjectStore,
  scope: AccountScope,
  resolvedIds: Set<string>,
): Promise<void> {
  const listRaw = await idbGet<CachedNotesList>(listsStore, [
    scope,
    "notes",
    "notes",
  ]);
  if (!listRaw?.summaries) {
    return;
  }
  const next = listRaw.summaries.filter(
    (summary) => !summaryMatchesEvict(summary, resolvedIds),
  );
  if (next.length === 0) {
    listsStore.delete([scope, "notes", "notes"]);
    return;
  }
  listsStore.put({ ...listRaw, summaries: next });
}

async function pruneFolderListStores(
  listsStore: IDBObjectStore,
  scope: AccountScope,
  resolvedIds: Set<string>,
): Promise<void> {
  const folderKeys = await idbGetAllKeys(listsStore, scope);
  for (const compoundKey of folderKeys) {
    if (!Array.isArray(compoundKey) || compoundKey[1] !== "folder") {
      continue;
    }
    const raw = await idbGet<CachedFolder>(listsStore, compoundKey);
    if (!raw?.children?.length) {
      continue;
    }
    const children = raw.children.filter((child) => !resolvedIds.has(child.id));
    if (children.length !== raw.children.length) {
      listsStore.put({ ...raw, children });
    }
  }
}

export async function deleteCachedNotes(
  scope: AccountScope,
  ids: string[],
): Promise<void> {
  const db = await openDb();
  if (!db || ids.length === 0) {
    return;
  }
  const resolvedIds = await resolveEvictIds(scope, ids);

  try {
    const tx = db.transaction([NOTES_STORE, LISTS_STORE], "readwrite");
    const notesStore = tx.objectStore(NOTES_STORE);
    for (const id of resolvedIds) {
      notesStore.delete([scope, id]);
    }
    const listsStore = tx.objectStore(LISTS_STORE);
    await pruneNotesListStore(listsStore, scope, resolvedIds);
    await pruneFolderListStores(listsStore, scope, resolvedIds);
    await awaitTx(tx);
  } catch {
    // memory-only fallback is acceptable
  }
}

function idbGet<T>(
  store: IDBObjectStore | IDBIndex,
  key: IDBValidKey | IDBKeyRange,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function idbGetAllKeys(
  store: IDBObjectStore,
  scope: AccountScope,
): Promise<IDBValidKey[]> {
  const keys: IDBValidKey[] = [];
  const range = IDBKeyRange.bound([scope], [scope, "\uffff"]);
  const request = store.openKeyCursor(range);
  await new Promise<void>((resolve, reject) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      keys.push(cursor.key);
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
  return keys;
}

/** Test helper: read raw note record from IDB. */
export async function __testReadRawCachedNote(
  scope: AccountScope,
  id: string,
): Promise<unknown> {
  const db = await openDb();
  if (!db) {
    return null;
  }
  const tx = db.transaction(NOTES_STORE, "readonly");
  const value = await idbGet<unknown>(tx.objectStore(NOTES_STORE), [scope, id]);
  await awaitTx(tx);
  return value ?? null;
}

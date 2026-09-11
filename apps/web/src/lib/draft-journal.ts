import type { CreateNoteInput } from "@miyulabmd/shared";
import {
  awaitTx,
  DRAFT_JOURNAL_STORE,
  DRAFT_PROMOTIONS_STORE,
  openDb,
} from "./offline-db.ts";
import type { LocalDraftId } from "./draft-store.ts";

export type DraftSyncPhase =
  | "pending"
  | "creating"
  | "updating"
  | "promoting"
  | "blocked"
  | "delete-pending";

export type DraftSyncState = {
  phase: DraftSyncPhase;
  createRequest?: { input: CreateNoteInput; revision: number };
  serverId?: string;
  acknowledgedRevision?: number;
  acknowledgedMarkdown?: string;
  acknowledgedLocalMarkdown?: string;
  pendingUpdate?: {
    revision: number;
    localMarkdown: string;
    expectedMarkdown: string;
    markdown: string;
  };
  lastError?: { code: string; message: string };
};

export type DraftJournalKind = "create-journal" | "draft";

export type DraftJournalRecord = {
  ownerId: string;
  localId: LocalDraftId;
  kind: DraftJournalKind;
  sync: DraftSyncState;
};

export type DraftPromotionRecord = {
  ownerId: string;
  localId: LocalDraftId;
  serverId: string;
  promotedAt: number;
};

type JournalListener = () => void;

const journalListeners = new Set<JournalListener>();
let journalStorageUnavailable = false;

function notifyJournalListeners(): void {
  for (const listener of journalListeners) {
    listener();
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

export function isJournalStorageUnavailable(): boolean {
  return journalStorageUnavailable;
}

export function resetDraftJournalForTests(): void {
  journalListeners.clear();
  journalStorageUnavailable = false;
}

export function subscribeDraftJournal(listener: JournalListener): () => void {
  journalListeners.add(listener);
  return () => {
    journalListeners.delete(listener);
  };
}

export async function getJournal(
  ownerId: string,
  localId: LocalDraftId,
): Promise<DraftJournalRecord | null> {
  const db = await openDb();
  if (!db) {
    return null;
  }
  try {
    const tx = db.transaction(DRAFT_JOURNAL_STORE, "readonly");
    const record = await idbGet<DraftJournalRecord>(
      tx.objectStore(DRAFT_JOURNAL_STORE),
      [ownerId, localId],
    );
    await awaitTx(tx);
    return record ?? null;
  } catch {
    return null;
  }
}

export async function listJournals(ownerId: string): Promise<DraftJournalRecord[]> {
  const db = await openDb();
  if (!db) {
    return [];
  }
  const results: DraftJournalRecord[] = [];
  try {
    const tx = db.transaction(DRAFT_JOURNAL_STORE, "readonly");
    const request = tx.objectStore(DRAFT_JOURNAL_STORE).openCursor();
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const record = cursor.value as DraftJournalRecord;
        if (record.ownerId === ownerId) {
          results.push(record);
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    await awaitTx(tx);
  } catch {
    return results;
  }
  return results;
}

export async function putJournal(record: DraftJournalRecord): Promise<boolean> {
  const db = await openDb();
  if (!db) {
    journalStorageUnavailable = true;
    return false;
  }
  try {
    const tx = db.transaction(DRAFT_JOURNAL_STORE, "readwrite");
    tx.objectStore(DRAFT_JOURNAL_STORE).put(record);
    await awaitTx(tx);
    notifyJournalListeners();
    return true;
  } catch {
    journalStorageUnavailable = true;
    return false;
  }
}

export async function deleteJournal(
  ownerId: string,
  localId: LocalDraftId,
): Promise<boolean> {
  const db = await openDb();
  if (!db) {
    return false;
  }
  try {
    const tx = db.transaction(DRAFT_JOURNAL_STORE, "readwrite");
    tx.objectStore(DRAFT_JOURNAL_STORE).delete([ownerId, localId]);
    await awaitTx(tx);
    notifyJournalListeners();
    return true;
  } catch {
    return false;
  }
}

export async function getPromotion(
  ownerId: string,
  localId: LocalDraftId,
): Promise<DraftPromotionRecord | null> {
  const db = await openDb();
  if (!db) {
    return null;
  }
  try {
    const tx = db.transaction(DRAFT_PROMOTIONS_STORE, "readonly");
    const record = await idbGet<DraftPromotionRecord>(
      tx.objectStore(DRAFT_PROMOTIONS_STORE),
      [ownerId, localId],
    );
    await awaitTx(tx);
    return record ?? null;
  } catch {
    return null;
  }
}

export async function listPromotions(
  ownerId: string,
): Promise<DraftPromotionRecord[]> {
  const db = await openDb();
  if (!db) {
    return [];
  }
  const results: DraftPromotionRecord[] = [];
  try {
    const tx = db.transaction(DRAFT_PROMOTIONS_STORE, "readonly");
    const request = tx.objectStore(DRAFT_PROMOTIONS_STORE).openCursor();
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve();
          return;
        }
        const record = cursor.value as DraftPromotionRecord;
        if (record.ownerId === ownerId) {
          results.push(record);
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
    await awaitTx(tx);
  } catch {
    return results;
  }
  return results;
}

export async function putPromotion(record: DraftPromotionRecord): Promise<boolean> {
  const db = await openDb();
  if (!db) {
    return false;
  }
  try {
    const tx = db.transaction(DRAFT_PROMOTIONS_STORE, "readwrite");
    tx.objectStore(DRAFT_PROMOTIONS_STORE).put(record);
    await awaitTx(tx);
    notifyJournalListeners();
    return true;
  } catch {
    return false;
  }
}

export function initialSyncState(
  createInput: CreateNoteInput,
  revision: number,
): DraftSyncState {
  return {
    acknowledgedLocalMarkdown: createInput.markdown ?? "",
    acknowledgedMarkdown: createInput.markdown ?? "",
    acknowledgedRevision: revision,
    createRequest: { input: createInput, revision },
    phase: "pending",
  };
}

export async function commitCreateJournal(input: {
  ownerId: string;
  localId: LocalDraftId;
  createInput: CreateNoteInput;
  revision: number;
}): Promise<boolean> {
  return putJournal({
    kind: "create-journal",
    localId: input.localId,
    ownerId: input.ownerId,
    sync: initialSyncState(input.createInput, input.revision),
  });
}

export async function convertJournalToDraftKind(
  ownerId: string,
  localId: LocalDraftId,
): Promise<boolean> {
  const journal = await getJournal(ownerId, localId);
  if (!journal) {
    return false;
  }
  return putJournal({ ...journal, kind: "draft" });
}

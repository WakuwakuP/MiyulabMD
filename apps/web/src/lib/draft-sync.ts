import type { CreateNoteInput, Note, SessionUser } from "@miyulabmd/shared";
import { validateDraftKeys } from "@miyulabmd/shared";
import type { ApiResult } from "./api.ts";
import { createNote, deleteNote, updateNote } from "./api.ts";
import { createNoteCollabSession } from "./collaboration-session.ts";
import { applyTextDiff } from "./y-text-diff.ts";
import {
  awaitDraftCommitted,
  deleteDraft,
  getDraft,
  type LocalDraft,
  type LocalDraftId,
  removeDraftFromMemory,
} from "./draft-store.ts";
import {
  convertJournalToDraftKind,
  deleteJournal,
  getJournal,
  getPromotion,
  type DraftJournalRecord,
  type DraftSyncState,
  listJournals,
  putJournal,
  putPromotion,
  subscribeDraftJournal,
} from "./draft-journal.ts";
import {
  adoptServerMarkdownWithoutCrdtMerge,
  mergeDraftMarkdownForPatch,
} from "./draft-markdown-merge.ts";
import { getLocalDraftEditor } from "./local-draft-editor.ts";
import { upsertNoteSummary } from "./list-cache.ts";
import { seedNoteCache } from "./note-cache.ts";
import { fetchNote } from "./api.ts";
import {
  accountScopeFromUserId,
  nextRequestGeneration,
  type SessionEpoch,
} from "./offline-types.ts";
import {
  getSessionSnapshot,
  subscribeSession,
  verifySession,
} from "./offline-session.ts";
import { writeCachedNote } from "./offline-cache.ts";
import {
  awaitTx,
  DRAFT_JOURNAL_STORE,
  DRAFT_PROMOTIONS_STORE,
  DRAFTS_STORE,
  openDb,
} from "./offline-db.ts";
import { subscribeOnlineStatus } from "./online-status.ts";
import { registerDraftSyncScheduler } from "./draft-sync-scheduler.ts";

const SYNC_CHANNEL = "miyulabmd-draft-sync";
const MAX_BACKOFF_MS = 60_000;
const COLLAB_WAIT_MS = 10_000;
const DELEGATE_WAIT_MS = 400;

type NavigateReplace = (path: string, options?: { replace?: boolean }) => void;

type OwnerFlush = {
  sessionEpoch: SessionEpoch;
  promise: Promise<void>;
};

const ownerFlushes = new Map<string, OwnerFlush>();
const promotionListeners = new Set<(ownerId: string, localId: LocalDraftId, serverId: string) => void>();

let serviceStarted = false;
let retryAttempt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let navigateReplace: NavigateReplace | null = null;
let openLocalRouteId: (() => LocalDraftId | null) | null = null;
let broadcast: BroadcastChannel | null = null;
let activeOwnerId: string | null = null;
let activeSessionEpoch: SessionEpoch | null = null;

function syncLockName(ownerId: string, localId: LocalDraftId): string {
  return `miyulabmd:draft-sync:${ownerId}:${localId}`;
}

function retryDelayMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
  const jitter = base * 0.2 * Math.random();
  return Math.round(base + jitter);
}

function clearRetryTimer(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function canRunSync(): boolean {
  const session = getSessionSnapshot();
  if (session.status !== "online-confirmed" || !session.user) {
    return false;
  }
  if (typeof document !== "undefined" && document.hidden) {
    return false;
  }
  return true;
}

function scheduleRetry(): void {
  clearRetryTimer();
  if (!canRunSync()) {
    return;
  }
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushPendingDrafts();
  }, retryDelayMs(retryAttempt));
  retryAttempt = Math.min(retryAttempt + 1, 16);
}

function resetRetryAttempt(): void {
  retryAttempt = 0;
  clearRetryTimer();
}

function notifyPromotion(
  ownerId: string,
  localId: LocalDraftId,
  serverId: string,
): void {
  for (const listener of promotionListeners) {
    listener(ownerId, localId, serverId);
  }
  broadcast?.postMessage({
    localId,
    ownerId,
    serverId,
    type: "promoted",
  });
}

async function acquireSyncLock(
  ownerId: string,
  localId: LocalDraftId,
): Promise<(() => void) | null> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    let releaseHold: (() => void) | null = null;
    let acquired = false;
    const held = new Promise<(() => void) | null>((resolve) => {
      void navigator.locks
        .request(syncLockName(ownerId, localId), { mode: "exclusive" }, () => {
          acquired = true;
          return new Promise<void>((hold) => {
            releaseHold = hold;
            resolve(() => releaseHold?.());
          });
        })
        .catch(() => {
          if (!acquired) {
            resolve(null);
          }
        });
    });
    const release = await Promise.race([
      held,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 500)),
    ]);
    return release;
  }
  return () => undefined;
}

async function delegateFlushToEditorTab(
  ownerId: string,
  localId: LocalDraftId,
): Promise<boolean> {
  if (!broadcast) {
    return false;
  }
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      channel.removeEventListener("message", onMessage);
      resolve(false);
    }, DELEGATE_WAIT_MS);
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        type?: string;
        requestId?: string;
        ok?: boolean;
      };
      if (
        data.type === "flush-done" &&
        data.requestId === requestId &&
        data.ok
      ) {
        clearTimeout(timer);
        channel.removeEventListener("message", onMessage);
        resolve(true);
      }
    };
    const channel = broadcast as BroadcastChannel;
    channel.addEventListener("message", onMessage);
    channel.postMessage({
      localId,
      ownerId,
      requestId,
      type: "flush-request",
    });
  });
}

async function readLatestMarkdown(
  ownerId: string,
  localId: LocalDraftId,
  revision: number,
): Promise<{ markdown: string; revision: number } | null> {
  const localEditor = getLocalDraftEditor(ownerId, localId);
  if (localEditor && !localEditor.readonly) {
    const drain = localEditor;
    await drain.flush();
    const draft = await awaitDraftCommitted(ownerId, localId, revision).catch(
      () => getDraft(ownerId, localId),
    );
    if (draft) {
      return { markdown: draft.markdown, revision: draft.revision };
    }
  } else {
    const delegated = await delegateFlushToEditorTab(ownerId, localId);
    if (delegated) {
      const draft = await getDraft(ownerId, localId);
      if (draft) {
        return { markdown: draft.markdown, revision: draft.revision };
      }
    }
  }
  const draft = await getDraft(ownerId, localId);
  if (draft) {
    return { markdown: draft.markdown, revision: draft.revision };
  }
  const journal = await getJournal(ownerId, localId);
  const markdown = journal?.sync.createRequest?.input.markdown ?? "";
  return { markdown, revision: journal?.sync.createRequest?.revision ?? 1 };
}

/** Fixed create body from journal only — never overlay latest draft fields (#97 B). */
export function buildCreateInput(
  journal: DraftJournalRecord,
): CreateNoteInput | null {
  const base = journal.sync.createRequest?.input;
  if (!base) {
    return null;
  }
  const keys = validateDraftKeys({
    clientDraftId: journal.localId,
    draftOwnerId: journal.ownerId,
  });
  if (!keys.ok) {
    return null;
  }
  return {
    ...base,
    clientDraftId: keys.clientDraftId,
    draftOwnerId: keys.draftOwnerId,
  };
}

async function commitJournalSync(
  ownerId: string,
  localId: LocalDraftId,
  sync: DraftSyncState,
  kind?: DraftJournalRecord["kind"],
): Promise<boolean> {
  const journal = await getJournal(ownerId, localId);
  if (!journal) {
    return false;
  }
  return putJournal({
    ...journal,
    kind: kind ?? journal.kind,
    sync,
  });
}

async function postCreate(
  createInput: CreateNoteInput,
): Promise<ApiResult<Note>> {
  return createNote(createInput);
}

async function patchMarkdown(
  serverId: string,
  body: {
    markdown: string;
    expectedMarkdown: string;
    clientDraftId: LocalDraftId;
    draftOwnerId: string;
  },
): Promise<ApiResult<Note>> {
  return updateNote(serverId, body);
}

function isRetriableFailure(result: ApiResult<unknown>): boolean {
  if (result.ok) {
    return false;
  }
  if (result.kind === "network") {
    return true;
  }
  if (result.kind === "http" && result.status >= 500) {
    return true;
  }
  return false;
}

function isAuthFailure(result: ApiResult<unknown>): boolean {
  if (result.ok) {
    return false;
  }
  return (
    result.kind === "http" &&
    (result.status === 401 || result.status === 403)
  ) || result.kind === "invalid-response";
}

function isBlockedFailure(result: ApiResult<unknown>): boolean {
  if (result.ok) {
    return false;
  }
  if (result.kind === "http") {
    return [400, 403, 404, 410].includes(result.status);
  }
  return false;
}

async function waitForCollabSynced(
  serverId: string,
  user: SessionUser,
  localEditor: ReturnType<typeof getLocalDraftEditor>,
): Promise<string | null> {
  const session = createNoteCollabSession({
    generation: nextRequestGeneration(),
    noteId: serverId,
    user,
  });
  session.setNeedsSession(true);
  session.setDesiredConnection(true);

  const synced = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), COLLAB_WAIT_MS);
    const unsub = session.subscribe((snapshot) => {
      if (snapshot.collabReady || snapshot.phase === "synced") {
        clearTimeout(timer);
        unsub();
        resolve(true);
      }
      if (snapshot.authStopped || snapshot.denied) {
        clearTimeout(timer);
        unsub();
        resolve(false);
      }
    });
  });

  const serverMarkdown = session.yMarkdown.toString();
  await session.close();

  if (!synced || !localEditor) {
    return serverMarkdown.length > 0 ? serverMarkdown : null;
  }

  const adopted = adoptServerMarkdownWithoutCrdtMerge(
    localEditor.yMarkdown.toString(),
    serverMarkdown,
  );
  applyTextDiff(localEditor.yMarkdown, adopted, "draft-sync-promote");
  return adopted;
}

async function promoteDraftRecord(input: {
  ownerId: string;
  localId: LocalDraftId;
  note: Note;
  sessionEpoch: SessionEpoch;
  adoptedMarkdown?: string | null;
}): Promise<boolean> {
  const db = await openDb();
  if (!db) {
    return false;
  }
  const scope = accountScopeFromUserId(input.ownerId);
  const note =
    input.adoptedMarkdown !== undefined && input.adoptedMarkdown !== null
      ? { ...input.note, markdown: input.adoptedMarkdown }
      : input.note;

  try {
    const tx = db.transaction(
      [
        DRAFT_PROMOTIONS_STORE,
        DRAFTS_STORE,
        DRAFT_JOURNAL_STORE,
      ],
      "readwrite",
    );
    tx.objectStore(DRAFT_PROMOTIONS_STORE).put({
      localId: input.localId,
      ownerId: input.ownerId,
      promotedAt: Date.now(),
      serverId: note.id,
    });
    tx.objectStore(DRAFTS_STORE).delete([input.ownerId, input.localId]);
    tx.objectStore(DRAFT_JOURNAL_STORE).delete([input.ownerId, input.localId]);
    await awaitTx(tx);
  } catch {
    return false;
  }

  removeDraftFromMemory(input.ownerId, input.localId);
  await writeCachedNote(note, scope, input.sessionEpoch);
  const { markdown: _markdown, ...summary } = note;
  upsertNoteSummary(summary);
  seedNoteCache(note);
  notifyPromotion(input.ownerId, input.localId, note.id);

  const openLocalId = openLocalRouteId?.();
  if (
    openLocalId === input.localId &&
    activeOwnerId === input.ownerId
  ) {
    navigateReplace?.(`/n/${note.id}`, { replace: true });
  }
  return true;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: ordered flush pipeline
async function flushOneDraft(
  ownerId: string,
  localId: LocalDraftId,
  sessionEpoch: SessionEpoch,
  user: SessionUser,
): Promise<void> {
  const release = await acquireSyncLock(ownerId, localId);
  if (!release) {
    return;
  }

  try {
    const journal = await getJournal(ownerId, localId);
    if (!journal || journal.sync.phase === "blocked") {
      return;
    }
    if (journal.sync.phase === "delete-pending") {
      await flushDeletePending(ownerId, localId, journal, sessionEpoch);
      return;
    }

    const draft = await getDraft(ownerId, localId);
    let sync = { ...journal.sync };

    if (sync.phase === "pending" || sync.phase === "creating") {
      sync = { ...sync, phase: "creating" };
      await commitJournalSync(ownerId, localId, sync);
      const createInput = buildCreateInput(journal);
      if (!createInput) {
        sync = {
          ...sync,
          lastError: { code: "invalid_input", message: "Invalid create input" },
          phase: "blocked",
        };
        await commitJournalSync(ownerId, localId, sync);
        return;
      }

      if (!sync.serverId) {
        const result = await postCreate(createInput);
        if (result.ok) {
          sync = {
            ...sync,
            acknowledgedLocalMarkdown: createInput.markdown ?? "",
            acknowledgedMarkdown: result.data.markdown,
            acknowledgedRevision: sync.createRequest?.revision ?? 1,
            phase: "updating",
            serverId: result.data.id,
          };
          const committed = await commitJournalSync(ownerId, localId, sync);
          if (!committed) {
            return;
          }
        } else if (isRetriableFailure(result)) {
          sync = {
            ...sync,
            lastError: {
              code: result.kind,
              message: result.error,
            },
            phase: "pending",
          };
          await commitJournalSync(ownerId, localId, sync);
          scheduleRetry();
          return;
        } else if (isAuthFailure(result)) {
          sync = {
            ...sync,
            lastError: { code: "auth", message: result.error },
            phase: "blocked",
          };
          await commitJournalSync(ownerId, localId, sync);
          return;
        } else if (isBlockedFailure(result)) {
          sync = {
            ...sync,
            lastError: {
              code: result.kind === "http" ? (result.code ?? String(result.status)) : result.kind,
              message: result.error,
            },
            phase: "blocked",
          };
          await commitJournalSync(ownerId, localId, sync);
          return;
        } else if (result.kind === "http" && result.status === 409) {
          sync = {
            ...sync,
            lastError: {
              code: result.code ?? "conflict",
              message: result.error,
            },
            phase: "blocked",
          };
          await commitJournalSync(ownerId, localId, sync);
          return;
        } else {
          scheduleRetry();
          return;
        }
      }
    }

    journal.sync = (await getJournal(ownerId, localId))?.sync ?? sync;
    sync = { ...journal.sync };

    const latest = await readLatestMarkdown(
      ownerId,
      localId,
      sync.acknowledgedRevision ?? 1,
    );
    if (!latest || !sync.serverId) {
      return;
    }

    const expectedMarkdown =
      sync.pendingUpdate?.expectedMarkdown ??
      sync.acknowledgedMarkdown ??
      latest.markdown;
    const localMarkdown = latest.markdown;

    if (localMarkdown !== (sync.acknowledgedLocalMarkdown ?? "")) {
      const merged = mergeDraftMarkdownForPatch({
        acknowledgedLocalMarkdown: sync.acknowledgedLocalMarkdown ?? expectedMarkdown,
        acknowledgedMarkdown: sync.acknowledgedMarkdown ?? expectedMarkdown,
        localMarkdown,
      });
      if (
        merged.markdown !== (sync.acknowledgedMarkdown ?? "") &&
        merged.markdown !== localMarkdown
      ) {
        sync = {
          ...sync,
          pendingUpdate: {
            expectedMarkdown,
            localMarkdown,
            markdown: merged.markdown,
            revision: latest.revision,
          },
          phase: "updating",
        };
        await commitJournalSync(ownerId, localId, sync);
      } else if (localMarkdown !== (sync.acknowledgedMarkdown ?? "")) {
        sync = {
          ...sync,
          pendingUpdate: {
            expectedMarkdown,
            localMarkdown,
            markdown: localMarkdown,
            revision: latest.revision,
          },
          phase: "updating",
        };
        await commitJournalSync(ownerId, localId, sync);
      }
    }

    sync = (await getJournal(ownerId, localId))?.sync ?? sync;
    const serverIdForPatch = sync.serverId;
    const pending = sync.pendingUpdate;
    if (
      pending &&
      pending.markdown !== (sync.acknowledgedMarkdown ?? "") &&
      serverIdForPatch
    ) {
      sync = { ...sync, phase: "updating" };
      await commitJournalSync(ownerId, localId, sync);
      const patchResult = await patchMarkdown(serverIdForPatch, {
        clientDraftId: localId,
        draftOwnerId: ownerId,
        expectedMarkdown: pending.expectedMarkdown,
        markdown: pending.markdown,
      });
      if (patchResult.ok) {
        sync = {
          ...sync,
          acknowledgedLocalMarkdown: pending.localMarkdown,
          acknowledgedMarkdown: patchResult.data.markdown,
          acknowledgedRevision: pending.revision,
          pendingUpdate: undefined,
        };
        await commitJournalSync(ownerId, localId, sync);
      } else if (isRetriableFailure(patchResult)) {
        scheduleRetry();
        return;
      } else if (patchResult.kind === "http" && patchResult.status === 409) {
        sync = {
          ...sync,
          lastError: {
            code: patchResult.code ?? "content_conflict",
            message: patchResult.error,
          },
          phase: "blocked",
        };
        await commitJournalSync(ownerId, localId, sync);
        return;
      } else if (isBlockedFailure(patchResult)) {
        sync = {
          ...sync,
          lastError: {
            code:
              patchResult.kind === "http"
                ? (patchResult.code ?? String(patchResult.status))
                : patchResult.kind,
            message: patchResult.error,
          },
          phase: "blocked",
        };
        await commitJournalSync(ownerId, localId, sync);
        return;
      } else {
        scheduleRetry();
        return;
      }
    }

    sync = (await getJournal(ownerId, localId))?.sync ?? sync;
    const serverId = sync.serverId;
    if (!serverId) {
      return;
    }

    const refreshed = await readLatestMarkdown(
      ownerId,
      localId,
      sync.acknowledgedRevision ?? 1,
    );
    const hasPending =
      sync.pendingUpdate &&
      sync.pendingUpdate.markdown !== (sync.acknowledgedMarkdown ?? "");
    const localDiffers =
      refreshed &&
      refreshed.markdown !== (sync.acknowledgedLocalMarkdown ?? "") &&
      refreshed.markdown !== (sync.acknowledgedMarkdown ?? "");
    if (hasPending || localDiffers) {
      scheduleRetry();
      return;
    }

    sync = { ...sync, phase: "promoting" };
    await commitJournalSync(ownerId, localId, sync);

    let adoptedMarkdown: string | null = null;
    const localEditor = getLocalDraftEditor(ownerId, localId);
    if (localEditor) {
      adoptedMarkdown = await waitForCollabSynced(
        serverId,
        user,
        localEditor,
      );
    }

    const noteResult = await fetchNote(serverId);
    const noteForPromote: Note =
      noteResult.ok
        ? noteResult.data
        : ({
            id: serverId,
            markdown: sync.acknowledgedMarkdown ?? refreshed?.markdown ?? "",
          } as Note);

    const promoted = await promoteDraftRecord({
      adoptedMarkdown,
      localId,
      note: noteForPromote,
      ownerId,
      sessionEpoch,
    });
    if (!promoted) {
      sync = { ...sync, phase: "pending" };
      await commitJournalSync(ownerId, localId, sync);
      scheduleRetry();
    }
  } finally {
    release();
  }
}

async function flushDeletePending(
  ownerId: string,
  localId: LocalDraftId,
  journal: DraftJournalRecord,
  _sessionEpoch: SessionEpoch,
): Promise<void> {
  const serverId = journal.sync.serverId;
  if (!serverId) {
    const latest = await getJournal(ownerId, localId);
    if (latest?.sync.phase === "delete-pending" && !latest.sync.serverId) {
      await deleteDraft(ownerId, localId);
      await deleteJournal(ownerId, localId);
    }
    return;
  }
  const result = await deleteNote(serverId);
  if (result.ok || (result.kind === "http" && [404, 410].includes(result.status))) {
    await deleteDraft(ownerId, localId);
    await deleteJournal(ownerId, localId);
    return;
  }
  if (isRetriableFailure(result)) {
    scheduleRetry();
  }
}

async function flushOwnerDrafts(
  ownerId: string,
  sessionEpoch: SessionEpoch,
  user: SessionUser,
): Promise<void> {
  activeOwnerId = ownerId;
  activeSessionEpoch = sessionEpoch;
  const journals = await listJournals(ownerId);
  const pending = journals.filter(
    (entry) =>
      entry.sync.phase !== "blocked" &&
      !(entry.sync.phase === "delete-pending" && !entry.sync.serverId),
  );
  for (const entry of pending) {
    await flushOneDraft(ownerId, entry.localId, sessionEpoch, user);
  }
  activeOwnerId = null;
  activeSessionEpoch = null;
}

export async function flushPendingDrafts(): Promise<void> {
  if (!canRunSync()) {
    return;
  }
  await verifySession();
  const session = getSessionSnapshot();
  if (session.status !== "online-confirmed" || !session.user) {
    return;
  }
  const ownerId = session.user.id;
  const existing = ownerFlushes.get(ownerId);
  if (existing && existing.sessionEpoch === session.sessionEpoch) {
    return existing.promise;
  }
  const promise = flushOwnerDrafts(
    ownerId,
    session.sessionEpoch,
    session.user,
  ).finally(() => {
    const current = ownerFlushes.get(ownerId);
    if (current?.promise === promise) {
      ownerFlushes.delete(ownerId);
    }
  });
  ownerFlushes.set(ownerId, {
    promise,
    sessionEpoch: session.sessionEpoch,
  });
  await promise;
  resetRetryAttempt();
}

export function maybeScheduleDraftSync(_localId?: LocalDraftId): void {
  if (!canRunSync()) {
    return;
  }
  void flushPendingDrafts().catch(() => {
    scheduleRetry();
  });
}

export function scheduleDraftSyncRetry(): void {
  retryAttempt = 0;
  void flushPendingDrafts().catch(() => {
    scheduleRetry();
  });
}

export function subscribeDraftPromotions(
  listener: (ownerId: string, localId: LocalDraftId, serverId: string) => void,
): () => void {
  promotionListeners.add(listener);
  return () => {
    promotionListeners.delete(listener);
  };
}

export async function getPromotedServerId(
  ownerId: string,
  localId: LocalDraftId,
): Promise<string | null> {
  const promotion = await getPromotion(ownerId, localId);
  return promotion?.serverId ?? null;
}

export function registerDraftSyncNavigation(
  navigate: NavigateReplace,
  getOpenLocalId: () => LocalDraftId | null,
): () => void {
  navigateReplace = navigate;
  openLocalRouteId = getOpenLocalId;
  return () => {
    if (navigateReplace === navigate) {
      navigateReplace = null;
      openLocalRouteId = null;
    }
  };
}

export async function ensureDraftJournalForLocalDraft(
  draft: LocalDraft,
  createInput: CreateNoteInput,
): Promise<boolean> {
  const existing = await getJournal(draft.ownerId, draft.localId);
  if (existing) {
    return true;
  }
  return putJournal({
    kind: "draft",
    localId: draft.localId,
    ownerId: draft.ownerId,
    sync: {
      acknowledgedLocalMarkdown: draft.markdown,
      acknowledgedMarkdown: draft.markdown,
      acknowledgedRevision: draft.revision,
      createRequest: { input: createInput, revision: draft.revision },
      phase: "pending",
    },
  });
}

export async function requestDraftDelete(
  ownerId: string,
  localId: LocalDraftId,
): Promise<void> {
  const journal = await getJournal(ownerId, localId);
  if (journal) {
    await putJournal({
      ...journal,
      sync: { ...journal.sync, phase: "delete-pending" },
    });
  } else {
    await deleteDraft(ownerId, localId);
    return;
  }
  maybeScheduleDraftSync(localId);
}

export async function promoteNoteAfterOnlineCreate(input: {
  ownerId: string;
  localId: LocalDraftId;
  note: Note;
  sessionEpoch: SessionEpoch;
}): Promise<boolean> {
  return promoteDraftRecord({
    adoptedMarkdown: null,
    localId: input.localId,
    note: input.note,
    ownerId: input.ownerId,
    sessionEpoch: input.sessionEpoch,
  });
}

export async function convertCreateJournalToDraft(
  ownerId: string,
  localId: LocalDraftId,
  draft: LocalDraft,
): Promise<boolean> {
  await convertJournalToDraftKind(ownerId, localId);
  const journal = await getJournal(ownerId, localId);
  if (!journal) {
    return false;
  }
  return putJournal({
    ...journal,
    kind: "draft",
    sync: {
      ...journal.sync,
      acknowledgedLocalMarkdown: draft.markdown,
      acknowledgedMarkdown: draft.markdown,
      acknowledgedRevision: draft.revision,
      phase: "pending",
    },
  });
}

export function startDraftSyncService(): () => void {
  if (serviceStarted) {
    return () => undefined;
  }
  serviceStarted = true;

  if (typeof BroadcastChannel !== "undefined") {
    broadcast = new BroadcastChannel(SYNC_CHANNEL);
    broadcast.onmessage = (event) => {
      const data = event.data as {
        type?: string;
        ownerId?: string;
        localId?: LocalDraftId;
        requestId?: string;
        serverId?: string;
      };
      if (data.type === "flush-request" && data.ownerId && data.localId) {
        const editor = getLocalDraftEditor(data.ownerId, data.localId);
        if (!editor || editor.readonly) {
          return;
        }
        void editor
          .flush()
          .then(() => {
            broadcast?.postMessage({
              localId: data.localId,
              ok: true,
              ownerId: data.ownerId,
              requestId: data.requestId,
              type: "flush-done",
            });
          })
          .catch(() => {
            broadcast?.postMessage({
              localId: data.localId,
              ok: false,
              ownerId: data.ownerId,
              requestId: data.requestId,
              type: "flush-done",
            });
          });
      }
      if (data.type === "promoted" && data.ownerId && data.localId && data.serverId) {
        notifyPromotion(data.ownerId, data.localId, data.serverId);
      }
    };
  }

  const unsubSession = subscribeSession((session) => {
    if (session.status === "online-confirmed" && session.user) {
      maybeScheduleDraftSync();
    } else {
      clearRetryTimer();
    }
  });
  const unsubOnline = subscribeOnlineStatus((online) => {
    if (online) {
      void verifySession().then(() => maybeScheduleDraftSync());
    }
  });
  const unsubJournal = subscribeDraftJournal(() => {
    maybeScheduleDraftSync();
  });
  const onVisible = () => {
    if (!document.hidden) {
      maybeScheduleDraftSync();
    } else {
      clearRetryTimer();
    }
  };
  document.addEventListener("visibilitychange", onVisible);

  registerDraftSyncScheduler(maybeScheduleDraftSync);
  maybeScheduleDraftSync();

  return () => {
    registerDraftSyncScheduler(null);
    serviceStarted = false;
    unsubSession();
    unsubOnline();
    unsubJournal();
    document.removeEventListener("visibilitychange", onVisible);
    broadcast?.close();
    broadcast = null;
    clearRetryTimer();
  };
}

/** Test-only: expose retry delay. */
export function __testDraftSyncRetryDelayMs(attempt: number): number {
  return retryDelayMs(attempt);
}

export function resetDraftSyncForTests(): void {
  ownerFlushes.clear();
  promotionListeners.clear();
  clearRetryTimer();
  retryAttempt = 0;
  serviceStarted = false;
  navigateReplace = null;
  openLocalRouteId = null;
  activeOwnerId = null;
  activeSessionEpoch = null;
}

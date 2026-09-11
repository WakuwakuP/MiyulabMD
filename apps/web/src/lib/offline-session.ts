import type { Note, SessionUser } from "@miyulabmd/shared";
import { fetchMe } from "./api.ts";
import { invalidateFolderCache, invalidateNotesCache } from "./list-cache.ts";
import { invalidateNoteCache, seedNoteCache } from "./note-cache.ts";
import {
  deleteScopeData,
  isOfflineDbBlocked,
  type OfflineSessionRecord,
  readSessionRecord,
  writeSessionRecord,
} from "./offline-db.ts";
import {
  type AccountScope,
  accountScopeFromUserId,
  GUEST_SCOPE,
  nextSessionEpoch,
  type SessionEpoch,
} from "./offline-types.ts";

export type SessionStatus =
  | "unknown"
  | "online-confirmed"
  | "offline-known"
  | "verification-error"
  | "unauthenticated"
  | "guest-confirmed";

export type SessionSnapshot = {
  status: SessionStatus;
  scope: AccountScope | null;
  user: SessionUser | null;
  sessionEpoch: SessionEpoch;
  offlineReadable: boolean;
  pendingCleanup: boolean;
  dbBlocked: boolean;
};

export type PersistenceCleanupHandler = {
  removeNotePersistence: (
    scope: AccountScope,
    ids: string[],
    reason: string,
  ) => void | Promise<void>;
  removeScopePersistence: (
    scope: AccountScope,
    reason: string,
  ) => void | Promise<void>;
};

const BROADCAST_CHANNEL = "miyulabmd-offline-session";

type BroadcastPayload = {
  sessionEpoch: SessionEpoch;
  snapshot: SessionSnapshot;
};

let snapshot: SessionSnapshot = {
  dbBlocked: false,
  offlineReadable: false,
  pendingCleanup: false,
  scope: null,
  sessionEpoch: nextSessionEpoch(),
  status: "unknown",
  user: null,
};

let lastConfirmedUser: OfflineSessionRecord["lastConfirmedUser"] = null;
let lastConfirmedAt: number | null = null;
let verifyGeneration = 0;
let logoutInProgress = false;
const listeners = new Set<(next: SessionSnapshot) => void>();
const cleanupHandlers = new Set<PersistenceCleanupHandler>();
let broadcastChannel: BroadcastChannel | null = null;

function emit(): void {
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function setSnapshot(next: SessionSnapshot): void {
  snapshot = next;
  emit();
}

function toConfirmedUser(
  user: SessionUser,
): NonNullable<OfflineSessionRecord["lastConfirmedUser"]> {
  return {
    displayName: user.displayName,
    email: user.email,
    id: user.id,
  };
}

function usersEqual(
  a: SessionUser | null | undefined,
  b: SessionUser | null | undefined,
): boolean {
  if (!(a || b)) {
    return true;
  }
  if (!(a && b)) {
    return false;
  }
  return a.id === b.id;
}

async function invokeScopeCleanup(
  scope: AccountScope,
  reason: string,
): Promise<void> {
  for (const handler of cleanupHandlers) {
    await handler.removeScopePersistence(scope, reason);
  }
}

async function invokeNoteCleanup(
  scope: AccountScope,
  ids: string[],
  reason: string,
): Promise<void> {
  for (const handler of cleanupHandlers) {
    await handler.removeNotePersistence(scope, ids, reason);
  }
}

function invalidateMemoryCaches(): void {
  invalidateNotesCache();
  invalidateNoteCache();
  invalidateFolderCache();
}

async function wipeScopeMemoryAndHooks(
  scope: AccountScope,
  reason: string,
): Promise<void> {
  invalidateMemoryCaches();
  await invokeScopeCleanup(scope, reason);
}

async function wipeScopeFully(
  scope: AccountScope,
  reason: string,
): Promise<boolean> {
  await wipeScopeMemoryAndHooks(scope, reason);
  return await deleteScopeData(scope);
}

async function persistCurrentSession(
  pendingCleanup = snapshot.pendingCleanup,
): Promise<boolean> {
  const record: OfflineSessionRecord = {
    confirmedAt: lastConfirmedAt,
    lastConfirmedUser,
    offlineReadable: snapshot.offlineReadable,
    pendingCleanup,
    scope: snapshot.scope,
    sessionEpoch: snapshot.sessionEpoch,
  };
  return await writeSessionRecord(record);
}

async function retryPendingCleanup(): Promise<void> {
  if (!(snapshot.pendingCleanup && snapshot.scope)) {
    return;
  }
  const ok = await deleteScopeData(snapshot.scope);
  if (ok) {
    setSnapshot({ ...snapshot, pendingCleanup: false });
    await persistCurrentSession(false);
  }
}

function applyRemoteSnapshot(remote: SessionSnapshot): void {
  if (remote.sessionEpoch < snapshot.sessionEpoch) {
    return;
  }
  if (remote.sessionEpoch > snapshot.sessionEpoch) {
    invalidateMemoryCaches();
  }
  snapshot = remote;
  emit();
}

function ensureBroadcastChannel(): void {
  if (typeof BroadcastChannel === "undefined" || broadcastChannel) {
    return;
  }
  broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL);
  broadcastChannel.onmessage = (event: MessageEvent<BroadcastPayload>) => {
    const payload = event.data;
    if (!payload?.snapshot) {
      return;
    }
    applyRemoteSnapshot(payload.snapshot);
  };
}

function broadcastSnapshot(): void {
  if (typeof BroadcastChannel === "undefined") {
    return;
  }
  ensureBroadcastChannel();
  broadcastChannel?.postMessage({
    sessionEpoch: snapshot.sessionEpoch,
    snapshot,
  } satisfies BroadcastPayload);
}

async function bumpSessionEpoch(): Promise<SessionEpoch> {
  const epoch = nextSessionEpoch();
  setSnapshot({
    ...snapshot,
    sessionEpoch: epoch,
  });
  await persistCurrentSession();
  broadcastSnapshot();
  return epoch;
}

async function handleConfirmedUserChange(nextUser: SessionUser): Promise<void> {
  const nextScope = accountScopeFromUserId(nextUser.id);
  const previousScope = snapshot.scope;
  const previousUser =
    snapshot.user ??
    (lastConfirmedUser
      ? {
          displayName: lastConfirmedUser.displayName,
          email: lastConfirmedUser.email,
          id: lastConfirmedUser.id,
        }
      : null);

  let nextEpoch = snapshot.sessionEpoch;
  let pendingCleanup = snapshot.pendingCleanup;

  if (previousScope === GUEST_SCOPE && nextScope !== GUEST_SCOPE) {
    nextEpoch = nextSessionEpoch();
    await wipeScopeMemoryAndHooks(GUEST_SCOPE, "guest-to-user");
    await deleteScopeData(GUEST_SCOPE);
  } else if (
    previousScope &&
    previousScope !== GUEST_SCOPE &&
    (previousScope !== nextScope || !usersEqual(previousUser, nextUser))
  ) {
    nextEpoch = nextSessionEpoch();
    const cleaned = await wipeScopeFully(previousScope, "user-changed");
    if (!cleaned) {
      pendingCleanup = true;
    }
  }

  lastConfirmedUser = toConfirmedUser(nextUser);
  lastConfirmedAt = Date.now();
  setSnapshot({
    ...snapshot,
    dbBlocked: isOfflineDbBlocked(),
    offlineReadable: true,
    pendingCleanup,
    scope: nextScope,
    sessionEpoch: nextEpoch,
    status: "online-confirmed",
    user: nextUser,
  });
  await persistCurrentSession();
  broadcastSnapshot();
}

async function handleConfirmedGuest(): Promise<void> {
  setSnapshot({
    ...snapshot,
    dbBlocked: false,
    offlineReadable: true,
    scope: GUEST_SCOPE,
    status: "guest-confirmed",
    user: null,
  });
  await persistCurrentSession();
  broadcastSnapshot();
}

async function handleOfflineKnown(): Promise<void> {
  if (!snapshot.scope) {
    return;
  }
  setSnapshot({
    ...snapshot,
    dbBlocked: false,
    offlineReadable: true,
    status: "offline-known",
    user: null,
  });
  await persistCurrentSession();
  broadcastSnapshot();
}

async function handleUnauthenticated(): Promise<void> {
  setSnapshot({
    ...snapshot,
    dbBlocked: false,
    offlineReadable: false,
    status: "unauthenticated",
    user: null,
  });
  await persistCurrentSession();
  broadcastSnapshot();
}

async function handleVerificationError(): Promise<void> {
  setSnapshot({
    ...snapshot,
    dbBlocked: false,
    offlineReadable: false,
    scope: null,
    status: "verification-error",
    user: null,
  });
  await persistCurrentSession();
  broadcastSnapshot();
}

export function getSessionSnapshot(): SessionSnapshot {
  return snapshot;
}

export function subscribeSession(
  listener: (next: SessionSnapshot) => void,
): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
}

export function registerPersistenceCleanup(
  handler: PersistenceCleanupHandler,
): () => void {
  cleanupHandlers.add(handler);
  return () => {
    cleanupHandlers.delete(handler);
  };
}

/** Stub for slice C — memory invalidate + cleanup hooks only for now. */
export function evictNotesEverywhere(ids: string[], reason: string): void {
  const scope = snapshot.scope;
  for (const id of ids) {
    invalidateNoteCache(id);
  }
  invalidateNotesCache();
  invalidateFolderCache();
  if (scope) {
    void invokeNoteCleanup(scope, ids, reason);
  }
}

export async function hydrateSessionFromDb(): Promise<void> {
  const record = await readSessionRecord();
  if (!record) {
    return;
  }
  lastConfirmedUser = record.lastConfirmedUser;
  lastConfirmedAt = record.confirmedAt;
  setSnapshot({
    ...snapshot,
    offlineReadable: record.offlineReadable,
    pendingCleanup: record.pendingCleanup ?? false,
    scope: record.scope,
    sessionEpoch: record.sessionEpoch,
    status: "unknown",
    user: null,
  });
  await retryPendingCleanup();
}

export async function verifySession(): Promise<SessionSnapshot> {
  ensureBroadcastChannel();
  const generation = ++verifyGeneration;
  const epochAtStart = snapshot.sessionEpoch;

  const result = await fetchMe();
  if (generation !== verifyGeneration) {
    return snapshot;
  }
  if (!result.ok && result.kind === "aborted") {
    return snapshot;
  }

  if (result.ok) {
    if (result.data.user) {
      await handleConfirmedUserChange(result.data.user);
    } else {
      await handleConfirmedGuest();
    }
    await retryPendingCleanup();
    return snapshot;
  }

  if (result.kind === "http" && result.status === 401) {
    await handleUnauthenticated();
    return snapshot;
  }

  if (result.kind === "invalid-response") {
    await handleVerificationError();
    return snapshot;
  }

  if (
    (result.kind === "network" ||
      (result.kind === "http" && result.status >= 500)) &&
    snapshot.scope &&
    lastConfirmedUser
  ) {
    setSnapshot({
      ...snapshot,
      scope: snapshot.scope,
      sessionEpoch: epochAtStart,
    });
    await handleOfflineKnown();
    return snapshot;
  }

  return snapshot;
}

export async function beginLogout(): Promise<void> {
  if (logoutInProgress) {
    return;
  }
  logoutInProgress = true;

  const scopeToWipe = snapshot.scope;
  await bumpSessionEpoch();

  setSnapshot({
    ...snapshot,
    offlineReadable: false,
    scope: null,
    status: "unauthenticated",
    user: null,
  });

  if (scopeToWipe) {
    const cleaned = await wipeScopeFully(scopeToWipe, "logout");
    if (!cleaned) {
      setSnapshot({ ...snapshot, pendingCleanup: true });
    }
  }

  await persistCurrentSession(snapshot.pendingCleanup);
  broadcastSnapshot();

  if (typeof window !== "undefined") {
    window.location.href = "/auth/logout";
  }
}

/** Test-only reset. */
export function resetOfflineSessionForTests(): void {
  verifyGeneration = 0;
  logoutInProgress = false;
  lastConfirmedUser = null;
  lastConfirmedAt = null;
  cleanupHandlers.clear();
  listeners.clear();
  if (broadcastChannel) {
    broadcastChannel.close();
    broadcastChannel = null;
  }
  snapshot = {
    dbBlocked: false,
    offlineReadable: false,
    pendingCleanup: false,
    scope: null,
    sessionEpoch: nextSessionEpoch(),
    status: "unknown",
    user: null,
  };
}

/** Test-only: seed session state without network. */
export function __testSetSessionState(
  partial: Partial<SessionSnapshot> & {
    lastConfirmedUser?: OfflineSessionRecord["lastConfirmedUser"];
    lastConfirmedAt?: number | null;
  },
): void {
  if ("lastConfirmedUser" in partial) {
    lastConfirmedUser = partial.lastConfirmedUser ?? null;
  }
  if ("lastConfirmedAt" in partial) {
    lastConfirmedAt = partial.lastConfirmedAt ?? null;
  }
  const { lastConfirmedUser: _u, lastConfirmedAt: _t, ...rest } = partial;
  setSnapshot({ ...snapshot, ...rest });
}

export function __testGetVerifyGeneration(): number {
  return verifyGeneration;
}

export function __testSeedNoteCache(note: Note): void {
  seedNoteCache(note);
}

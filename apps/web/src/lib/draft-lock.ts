import {
  type DraftLockRecord,
  type LocalDraftId,
  readDraftLock,
  removeDraftLock,
  writeDraftLock,
} from "./draft-store.ts";
import { nextLockEpoch, type LockEpoch } from "./offline-types.ts";

const TAB_ID =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `tab-${Math.random().toString(36).slice(2)}`;

const LEASE_MS = 15_000;
const RENEW_MS = 5_000;

export type DraftLockHandle = {
  lockEpoch: LockEpoch;
  release: () => void;
};

let navigatorLocksSupported =
  typeof navigator !== "undefined" && "locks" in navigator;

/** Test hook to force IDB lease fallback. */
export function setNavigatorLocksSupportedForTests(value: boolean): void {
  navigatorLocksSupported = value;
}

function lockName(ownerId: string, localId: LocalDraftId): string {
  return `miyulabmd:draft:${ownerId}:${localId}`;
}

async function tryAcquireIdbLease(
  ownerId: string,
  localId: LocalDraftId,
): Promise<DraftLockHandle | null> {
  const lockEpoch = nextLockEpoch();
  const now = Date.now();
  const existing = await readDraftLock(ownerId, localId);
  if (existing && existing.leaseExpiresAt > now && existing.tabId !== TAB_ID) {
    return null;
  }
  const record: DraftLockRecord = {
    leaseExpiresAt: now + LEASE_MS,
    localId,
    lockEpoch,
    ownerId,
    tabId: TAB_ID,
  };
  const ok = await writeDraftLock(record);
  if (!ok) {
    return null;
  }
  let released = false;
  let renewTimer: ReturnType<typeof setInterval> | undefined;
  const renew = async () => {
    if (released) {
      return;
    }
    const current = await readDraftLock(ownerId, localId);
    if (!current || current.tabId !== TAB_ID || current.lockEpoch !== lockEpoch) {
      released = true;
      if (renewTimer) {
        clearInterval(renewTimer);
      }
      return;
    }
    await writeDraftLock({
      ...current,
      leaseExpiresAt: Date.now() + LEASE_MS,
    });
  };
  renewTimer = setInterval(() => {
    void renew();
  }, RENEW_MS);
  return {
    lockEpoch,
    release: () => {
      if (released) {
        return;
      }
      released = true;
      if (renewTimer) {
        clearInterval(renewTimer);
      }
      void removeDraftLock(ownerId, localId);
    },
  };
}

export async function acquireDraftLock(
  ownerId: string,
  localId: LocalDraftId,
): Promise<DraftLockHandle | null> {
  if (navigatorLocksSupported && navigator.locks) {
    let releaseHold: (() => void) | null = null;
    let acquired = false;
    const lockEpoch = nextLockEpoch();
    const held = new Promise<DraftLockHandle | null>((resolve) => {
      void navigator.locks
        .request(lockName(ownerId, localId), { mode: "exclusive" }, () => {
          acquired = true;
          return new Promise<void>((hold) => {
            releaseHold = hold;
            resolve({
              lockEpoch,
              release: () => {
                releaseHold?.();
              },
            });
          });
        })
        .catch(() => {
          if (!acquired) {
            resolve(null);
          }
        });
    });
    const handle = await Promise.race([
      held,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
    ]);
    if (handle) {
      return handle;
    }
  }
  return tryAcquireIdbLease(ownerId, localId);
}

export function draftTabId(): string {
  return TAB_ID;
}

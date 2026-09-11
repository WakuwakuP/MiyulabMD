import { getSessionSnapshot } from "./offline-session.ts";
import type { AccountScope } from "./offline-types.ts";

const HYDRATABLE_STATUSES = new Set([
  "online-confirmed",
  "offline-known",
  "guest-confirmed",
]);

/** Scope whose private IDB / memory cache may be shown. */
export function getHydratableScope(): AccountScope | null {
  const snap = getSessionSnapshot();
  if (!snap.offlineReadable) {
    return null;
  }
  if (!HYDRATABLE_STATUSES.has(snap.status)) {
    return null;
  }
  return snap.scope;
}

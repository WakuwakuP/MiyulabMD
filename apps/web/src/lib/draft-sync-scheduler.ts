import type { LocalDraftId } from "./draft-store.ts";

type DraftSyncScheduler = (localId?: LocalDraftId) => void;

let scheduler: DraftSyncScheduler | null = null;

export function registerDraftSyncScheduler(
  next: DraftSyncScheduler | null,
): void {
  scheduler = next;
}

export function maybeScheduleDraftSync(localId?: LocalDraftId): void {
  scheduler?.(localId);
}

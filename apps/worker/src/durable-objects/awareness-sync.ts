import * as encoding from "lib0/encoding";

export type AwarenessChanges = {
  added: number[];
  updated: number[];
  removed: number[];
};

/** `encodeAwarenessUpdate` に渡す clientId（追加・更新・削除を含む）。 */
export function clientsForAwarenessBroadcast(
  changes: AwarenessChanges,
): number[] {
  return [...changes.added, ...changes.updated, ...changes.removed];
}

/**
 * 接続が所有する clientId。`updated` は見ない。
 * 他タブ／他人のリレーは added ではなく updated になる。
 */
export function applyOwnedClientChanges(
  owned: Iterable<number>,
  changes: Pick<AwarenessChanges, "added" | "removed">,
): number[] {
  const next = new Set(owned);
  for (const id of changes.added) {
    next.add(id);
  }
  for (const id of changes.removed) {
    next.delete(id);
  }
  return [...next];
}

export function nextAwarenessClocks(
  clocks: Record<string, number>,
  owned: Iterable<number>,
  changes: AwarenessChanges,
  clockOf: (clientId: number) => number | undefined,
): Record<string, number> {
  const ownedSet = new Set(owned);
  const next = { ...clocks };
  for (const id of changes.added) {
    const clock = clockOf(id);
    if (clock !== undefined) {
      next[String(id)] = clock;
    }
  }
  for (const id of changes.updated) {
    if (!ownedSet.has(id)) {
      continue;
    }
    const clock = clockOf(id);
    if (clock !== undefined) {
      next[String(id)] = clock;
    }
  }
  for (const id of changes.removed) {
    delete next[String(id)];
  }
  return next;
}

/** meta が無いとき（hibernation 直後）用の削除フレーム。 */
export function encodeAwarenessNullUpdate(
  clients: Array<{ clientId: number; clock: number }>,
): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, clients.length);
  for (const { clientId, clock } of clients) {
    encoding.writeVarUint(encoder, clientId);
    encoding.writeVarUint(encoder, clock);
    encoding.writeVarString(encoder, "null");
  }
  return encoding.toUint8Array(encoder);
}

export function clockForRemoval(stored: number | undefined): number {
  return stored ?? Date.now();
}

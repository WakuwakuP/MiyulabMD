import {
  clearFolderInflight,
  evictNotesFromFolderCache,
  removeNoteSummary,
} from "./list-cache.ts";
import {
  dismissStaleSsrPreview,
  removeNoteBootstrap,
  removeSsrPreview,
} from "./note-bootstrap.ts";
import {
  clearNoteInflight,
  invalidateNoteCache,
  peekNote,
} from "./note-cache.ts";
import { deleteCachedNotes } from "./offline-cache.ts";
import {
  getSessionSnapshot,
  invokePersistenceCleanupForNotes,
} from "./offline-session.ts";
import type { AccountScope } from "./offline-types.ts";

function collectResolvedIds(ids: string[]): Set<string> {
  const resolved = new Set<string>();
  for (const id of ids) {
    resolved.add(id);
    const cached = peekNote(id);
    if (cached) {
      resolved.add(cached.id);
      if (cached.shortId) {
        resolved.add(cached.shortId);
      }
    }
  }
  return resolved;
}

export async function evictNotesEverywhereImpl(
  ids: string[],
  reason: string,
  scope: AccountScope | null = getSessionSnapshot().scope,
): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  const resolved = collectResolvedIds(ids);

  for (const id of resolved) {
    invalidateNoteCache(id);
    removeNoteSummary(id);
    dismissStaleSsrPreview(id);
    removeNoteBootstrap(id);
  }
  removeSsrPreview();

  evictNotesFromFolderCache(resolved);
  clearNoteInflight();
  clearFolderInflight();

  if (scope) {
    await deleteCachedNotes(scope, [...resolved]);
    await invokePersistenceCleanupForNotes(scope, [...resolved], reason);
  }
}

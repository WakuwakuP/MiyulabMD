import type { FolderAccess, NoteSummary } from "@miyulabmd/shared";
import { type ApiResult, fetchFolder, fetchNotes } from "./api.ts";

let notesCache: NoteSummary[] | null = null;
let notesInflight: Promise<NoteSummary[]> | null = null;

const folderCache = new Map<string, FolderAccess>();
const folderInflight = new Map<string, Promise<ApiResult<FolderAccess>>>();

export function folderCacheKey(id?: string | null): string {
  return id ?? "__root__";
}

export function peekNotes(): NoteSummary[] | null {
  return notesCache;
}

export function peekFolder(id?: string | null): FolderAccess | undefined {
  return folderCache.get(folderCacheKey(id));
}

export function invalidateNotesCache(): void {
  notesCache = null;
  notesInflight = null;
}

export function invalidateFolderCache(id?: string | null): void {
  if (id === undefined) {
    folderCache.clear();
    folderInflight.clear();
    return;
  }
  const key = folderCacheKey(id);
  folderCache.delete(key);
  folderInflight.delete(key);
}

export function seedFolderCache(data: FolderAccess): void {
  folderCache.set(folderCacheKey(data.id), data);
}

export async function loadNotes(force = false): Promise<NoteSummary[]> {
  if (!force && notesCache) return notesCache;
  if (!force && notesInflight) return notesInflight;

  const promise = fetchNotes().then((notes) => {
    notesCache = notes;
    notesInflight = null;
    return notes;
  });
  notesInflight = promise;
  return promise;
}

export async function loadFolder(
  id?: string | null,
  force = false,
): Promise<ApiResult<FolderAccess>> {
  const key = folderCacheKey(id);
  if (!force) {
    const cached = folderCache.get(key);
    if (cached) return { ok: true, data: cached };
    const inflight = folderInflight.get(key);
    if (inflight) return inflight;
  }

  const promise = fetchFolder(id).then((result) => {
    folderInflight.delete(key);
    if (result.ok) folderCache.set(key, result.data);
    return result;
  });
  folderInflight.set(key, promise);
  return promise;
}

export function prefetchFolder(id?: string | null): void {
  void loadFolder(id);
}

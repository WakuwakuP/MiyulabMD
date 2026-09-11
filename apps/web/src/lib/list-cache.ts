import type { FolderAccess, NoteSummary } from "@miyulabmd/shared";
import { type ApiResult, fetchFolder, fetchNotes } from "./api.ts";
import { loadOgCards } from "./markdown.ts";
import { loadNote, noteBodyNeedsPrefetch } from "./note-cache.ts";
import {
  readCachedFolder,
  readCachedNotesList,
  writeCachedFolder,
  writeCachedNotesList,
} from "./offline-cache.ts";
import { isPersistableRemoteId } from "./offline-db.ts";
import { getHydratableScope } from "./offline-scope.ts";
import { getSessionSnapshot } from "./offline-session.ts";
import {
  nextRequestGeneration,
  type RequestGeneration,
} from "./offline-types.ts";

export type NotesLoadState = "unhydrated" | "hydrating" | "ready" | "error";

export type LoadNotesResult = {
  notes: NoteSummary[];
  source: "memory" | "idb" | "server";
  cachedAt: number;
  verifiedForSession: boolean;
};

let notesCache: NoteSummary[] | null = null;
let notesInflight: Promise<NoteSummary[]> | null = null;
let notesLoadState: NotesLoadState = "unhydrated";
let notesRequestGeneration: RequestGeneration | null = null;
let lastLoadNotesResult: LoadNotesResult | null = null;
const pendingMutations: Array<(notes: NoteSummary[]) => NoteSummary[]> = [];

const folderCache = new Map<string, FolderAccess>();
const folderInflight = new Map<string, Promise<ApiResult<FolderAccess>>>();

let prefetchAbort: AbortController | null = null;

export function folderCacheKey(id?: string | null): string {
  return id ?? "__root__";
}

export function peekNotes(): NoteSummary[] | null {
  return notesCache;
}

export function peekFolder(id?: string | null): FolderAccess | undefined {
  return folderCache.get(folderCacheKey(id));
}

export function getNotesLoadState(): NotesLoadState {
  return notesLoadState;
}

export function getLastLoadNotesResult(): LoadNotesResult | null {
  return lastLoadNotesResult;
}

export function invalidateNotesCache(): void {
  notesCache = null;
  notesInflight = null;
  notesLoadState = "unhydrated";
  notesRequestGeneration = null;
  lastLoadNotesResult = null;
  pendingMutations.length = 0;
  prefetchAbort?.abort();
  prefetchAbort = null;
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

function applyPendingMutations(notes: NoteSummary[]): NoteSummary[] {
  return pendingMutations.reduce((current, mutate) => mutate(current), notes);
}

function enqueueMutation(
  mutate: (notes: NoteSummary[]) => NoteSummary[],
): void {
  if (notesLoadState === "ready" && notesCache) {
    notesCache = mutate(notesCache);
    return;
  }
  pendingMutations.push(mutate);
}

function upsertIntoList(
  current: NoteSummary[],
  note: NoteSummary,
): NoteSummary[] {
  const index = current.findIndex((item) => item.id === note.id);
  return index === -1
    ? [note, ...current]
    : current.map((item, itemIndex) => (itemIndex === index ? note : item));
}

export function upsertNoteSummary(note: NoteSummary): void {
  const mutate = (current: NoteSummary[]) => upsertIntoList(current, note);
  enqueueMutation(mutate);
  if (notesLoadState !== "ready" || notesCache) {
    notesCache = mutate(notesCache ?? []);
  }
}

export function removeNoteSummary(id: string): void {
  enqueueMutation((current) => current.filter((item) => item.id !== id));
  if (notesCache) {
    notesCache = notesCache.filter((item) => item.id !== id);
  }
}

function isCurrentNotesLoad(generation: RequestGeneration): boolean {
  return notesRequestGeneration === generation;
}

function setLoadResult(
  notes: NoteSummary[],
  source: LoadNotesResult["source"],
  cachedAt: number,
  verifiedForSession: boolean,
  state: NotesLoadState,
): NoteSummary[] {
  notesCache = notes;
  notesLoadState = state;
  lastLoadNotesResult = { cachedAt, notes, source, verifiedForSession };
  return notes;
}

async function hydrateNotesFromIdb(
  scope: NonNullable<ReturnType<typeof getHydratableScope>>,
): Promise<NoteSummary[] | null> {
  return await readCachedNotesList(scope);
}

async function hydrateFolderFromIdb(
  scope: NonNullable<ReturnType<typeof getHydratableScope>>,
  id?: string | null,
): Promise<FolderAccess | null> {
  return await readCachedFolder(scope, id);
}

const PREFETCH_BODY_LIMIT = 20;
const PREFETCH_CONCURRENCY = 2;

export function abortNoteBodyPrefetch(): void {
  prefetchAbort?.abort();
  prefetchAbort = null;
}

async function prefetchOneBody(
  summary: NoteSummary,
  scope: NonNullable<ReturnType<typeof getHydratableScope>>,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted || !(await noteBodyNeedsPrefetch(summary.id, scope))) {
    return;
  }
  const result = await loadNote(summary.id);
  if (signal.aborted || !result.ok) {
    return;
  }
  void loadOgCards(result.data.markdown);
}

export async function prefetchNoteBodies(
  summaries: NoteSummary[],
  scope: NonNullable<ReturnType<typeof getHydratableScope>>,
): Promise<void> {
  prefetchAbort?.abort();
  const controller = new AbortController();
  prefetchAbort = controller;

  const candidates = [...summaries]
    .filter((summary) => isPersistableRemoteId(summary.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, PREFETCH_BODY_LIMIT);

  let index = 0;
  const takeNext = () => {
    const next = candidates[index];
    index += 1;
    return next;
  };

  async function worker(): Promise<void> {
    for (let current = takeNext(); current; current = takeNext()) {
      if (controller.signal.aborted) {
        return;
      }
      await prefetchOneBody(current, scope, controller.signal);
    }
  }

  await Promise.all(
    Array.from({ length: PREFETCH_CONCURRENCY }, () => worker()),
  );
}

type NotesFetchContext = {
  generation: RequestGeneration;
  sessionEpoch: ReturnType<typeof getSessionSnapshot>["sessionEpoch"];
  scope: ReturnType<typeof getHydratableScope>;
  force: boolean;
  previous: NoteSummary[] | null;
};

async function hydrateNotesListFromIdb(
  ctx: NotesFetchContext,
): Promise<{ hydrated: boolean; cachedAt: number }> {
  if (!(ctx.scope && (!notesCache || ctx.force))) {
    return { cachedAt: Date.now(), hydrated: false };
  }
  const fromIdb = await hydrateNotesFromIdb(ctx.scope);
  if (!(fromIdb && isCurrentNotesLoad(ctx.generation))) {
    return { cachedAt: Date.now(), hydrated: false };
  }
  notesCache = applyPendingMutations(fromIdb);
  if (!ctx.force) {
    notesLoadState = "hydrating";
  }
  return {
    cachedAt: lastLoadNotesResult?.cachedAt ?? Date.now(),
    hydrated: true,
  };
}

function finishNotesFetchSuccess(
  data: NoteSummary[],
  ctx: NotesFetchContext,
  hydratedFromIdb: boolean,
): NoteSummary[] {
  const applied = applyPendingMutations(data);
  pendingMutations.length = 0;
  const verified =
    ctx.force && getSessionSnapshot().sessionEpoch === ctx.sessionEpoch;
  const result = setLoadResult(
    applied,
    ctx.force || !hydratedFromIdb ? "server" : "idb",
    Date.now(),
    verified,
    "ready",
  );
  if (ctx.scope) {
    void writeCachedNotesList(applied, ctx.scope, ctx.sessionEpoch);
    void prefetchNoteBodies(applied, ctx.scope);
  }
  notesInflight = null;
  return result;
}

function finishNotesFetchFailure(
  ctx: NotesFetchContext,
  hydratedFromIdb: boolean,
  idbCachedAt: number,
): NoteSummary[] {
  if (ctx.previous || notesCache) {
    const kept = notesCache ?? ctx.previous ?? [];
    notesLoadState = "ready";
    lastLoadNotesResult = {
      cachedAt: idbCachedAt,
      notes: kept,
      source: hydratedFromIdb ? "idb" : "memory",
      verifiedForSession: false,
    };
    notesInflight = null;
    return kept;
  }
  notesCache = null;
  notesLoadState = "error";
  lastLoadNotesResult = null;
  notesInflight = null;
  return [];
}

async function fetchNotesList(ctx: NotesFetchContext): Promise<NoteSummary[]> {
  const { cachedAt, hydrated } = await hydrateNotesListFromIdb(ctx);
  if (!ctx.force && notesCache && notesLoadState !== "ready") {
    notesCache = applyPendingMutations(notesCache);
  }

  const fetchResult = await fetchNotes();
  if (!isCurrentNotesLoad(ctx.generation)) {
    return notesCache ?? ctx.previous ?? [];
  }
  if (fetchResult.ok) {
    return finishNotesFetchSuccess(fetchResult.data, ctx, hydrated);
  }
  return finishNotesFetchFailure(ctx, hydrated, cachedAt);
}

export async function loadNotes(force = false): Promise<NoteSummary[]> {
  const generation = nextRequestGeneration();
  notesRequestGeneration = generation;
  const ctx: NotesFetchContext = {
    force,
    generation,
    previous: notesCache,
    scope: getHydratableScope(),
    sessionEpoch: getSessionSnapshot().sessionEpoch,
  };

  if (!force && notesCache && notesLoadState === "ready") {
    return notesCache;
  }
  if (!force && notesInflight) {
    return notesInflight;
  }
  if (notesLoadState === "unhydrated") {
    notesLoadState = "hydrating";
  }

  const promise = fetchNotesList(ctx);
  notesInflight = promise;
  return await promise;
}

export async function loadFolder(
  id?: string | null,
  force = false,
): Promise<ApiResult<FolderAccess>> {
  const key = folderCacheKey(id);
  const generation = nextRequestGeneration();
  const sessionEpoch = getSessionSnapshot().sessionEpoch;
  const scope = getHydratableScope();

  if (force) {
    folderInflight.delete(key);
  } else {
    const cached = folderCache.get(key);
    if (cached) {
      return { data: cached, ok: true as const };
    }
    const inflight = folderInflight.get(key);
    if (inflight) {
      return inflight;
    }
    if (scope) {
      const fromIdb = await hydrateFolderFromIdb(scope, id);
      if (fromIdb) {
        folderCache.set(key, fromIdb);
        return { data: fromIdb, ok: true as const };
      }
    }
  }

  const promise = fetchFolder(id).then(async (result) => {
    folderInflight.delete(key);
    if (result.ok) {
      folderCache.set(key, result.data);
      if (scope) {
        void writeCachedFolder(result.data, scope, sessionEpoch, id);
      }
      return result;
    }
    if (scope) {
      const fromIdb = await hydrateFolderFromIdb(scope, id);
      if (fromIdb) {
        folderCache.set(key, fromIdb);
        return { data: fromIdb, ok: true as const };
      }
    }
    return result;
  });
  folderInflight.set(key, promise);
  void generation;
  return await promise;
}

export function prefetchFolder(id?: string | null): void {
  void loadFolder(id);
}

export function clearFolderInflight(): void {
  folderInflight.clear();
}

export function evictNotesFromFolderCache(ids: Set<string>): void {
  for (const [key, folder] of folderCache.entries()) {
    if (!folder.children.some((child) => ids.has(child.id))) {
      continue;
    }
    folderCache.set(key, {
      ...folder,
      children: folder.children.filter((child) => !ids.has(child.id)),
    });
  }
}

export function __testResetNotesLoadState(): void {
  notesLoadState = "unhydrated";
  notesRequestGeneration = null;
  lastLoadNotesResult = null;
  pendingMutations.length = 0;
}

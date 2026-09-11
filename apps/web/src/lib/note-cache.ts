import type { Note } from "@miyulabmd/shared";
import { type ApiResult, fetchNote } from "./api.ts";
import { loadOgCards } from "./markdown.ts";
import { consumeOgBootstrap, readNoteBootstrap } from "./note-bootstrap.ts";
import {
  hasCachedNoteBody,
  readCachedNote,
  writeCachedNote,
} from "./offline-cache.ts";
import { cachedToNote } from "./offline-cache-types.ts";
import { getHydratableScope } from "./offline-scope.ts";
import { getSessionSnapshot } from "./offline-session.ts";
import {
  nextRequestGeneration,
  type RequestGeneration,
  type SessionEpoch,
} from "./offline-types.ts";

const noteCache = new Map<string, Note>();
const noteInflight = new Map<string, Promise<ApiResult<Note>>>();
const noteLoadMeta = new Map<
  string,
  {
    source: "memory" | "idb" | "server";
    cachedAt: number;
    verifiedForSession: boolean;
  }
>();

export type LoadedNote = {
  note: Note;
  source: "memory" | "idb" | "server";
  cachedAt: number;
  verifiedForSession: boolean;
};

type NoteLoadContext = {
  scope: ReturnType<typeof getHydratableScope>;
  sessionEpoch: SessionEpoch;
  generation: RequestGeneration;
  id: string;
};

const noteGenerations = new Map<string, RequestGeneration>();

function matchesGeneration(ctx: NoteLoadContext): boolean {
  const snap = getSessionSnapshot();
  return (
    snap.sessionEpoch === ctx.sessionEpoch &&
    noteGenerations.get(ctx.id) === ctx.generation
  );
}

function rememberMeta(
  id: string,
  meta: {
    source: "memory" | "idb" | "server";
    cachedAt: number;
    verifiedForSession: boolean;
  },
): void {
  noteLoadMeta.set(id, meta);
  const note = noteCache.get(id);
  if (note?.shortId) {
    noteLoadMeta.set(note.shortId, meta);
  }
}

export function getLoadedNoteMeta(
  id: string,
): Omit<LoadedNote, "note"> | undefined {
  return noteLoadMeta.get(id);
}

export function peekNote(id: string): Note | undefined {
  return noteCache.get(id);
}

export function noteFromCaches(id: string): Note | undefined {
  consumeOgBootstrap();
  const peeked = peekNote(id);
  if (peeked) {
    return peeked;
  }
  const boot = readNoteBootstrap(id);
  if (boot) {
    seedNoteCache(boot);
    return boot;
  }
  return undefined;
}

export function seedNoteCache(note: Note): void {
  noteCache.set(note.id, note);
  if (note.shortId) {
    noteCache.set(note.shortId, note);
  }
}

export function invalidateNoteCache(id?: string): void {
  if (!id) {
    noteCache.clear();
    noteInflight.clear();
    noteLoadMeta.clear();
    return;
  }
  const cached = noteCache.get(id);
  noteCache.delete(id);
  noteInflight.delete(id);
  noteLoadMeta.delete(id);
  if (cached) {
    noteCache.delete(cached.id);
    noteLoadMeta.delete(cached.id);
    if (cached.shortId) {
      noteCache.delete(cached.shortId);
      noteLoadMeta.delete(cached.shortId);
    }
  }
}

function okFromNote(
  note: Note,
  ctx: NoteLoadContext,
  source: LoadedNote["source"],
  cachedAt: number,
  verifiedForSession: boolean,
): ApiResult<Note> {
  if (!matchesGeneration(ctx)) {
    const current = noteCache.get(note.id);
    if (current) {
      return { data: current, ok: true as const };
    }
    return {
      error: "Stale load",
      kind: "aborted" as const,
      ok: false as const,
      status: 0 as const,
    };
  }
  rememberMeta(note.id, { cachedAt, source, verifiedForSession });
  seedNoteCache(note);
  return { data: note, ok: true as const };
}

async function hydrateNoteFromIdb(
  id: string,
  scope: NonNullable<ReturnType<typeof getHydratableScope>>,
): Promise<Note | null> {
  const cached = await readCachedNote(scope, id);
  if (!cached) {
    return null;
  }
  return cachedToNote(cached);
}

function staleNoteResult(id: string): ApiResult<Note> {
  const current = noteCache.get(id);
  if (current) {
    return { data: current, ok: true as const };
  }
  return {
    error: "Stale load",
    kind: "aborted" as const,
    ok: false as const,
    status: 0 as const,
  };
}

async function noteFromIdbResult(
  id: string,
  ctx: NoteLoadContext,
): Promise<ApiResult<Note> | null> {
  if (!ctx.scope) {
    return null;
  }
  const fromIdb = await hydrateNoteFromIdb(id, ctx.scope);
  if (!(fromIdb && matchesGeneration(ctx))) {
    return null;
  }
  const raw = await readCachedNote(ctx.scope, id);
  return okFromNote(fromIdb, ctx, "idb", raw?.cachedAt ?? Date.now(), false);
}

async function finalizeNoteFetch(
  id: string,
  result: ApiResult<Note>,
  ctx: NoteLoadContext,
  force: boolean,
): Promise<ApiResult<Note>> {
  noteInflight.delete(id);
  if (!matchesGeneration(ctx)) {
    return staleNoteResult(id);
  }
  if (result.ok) {
    const verified =
      force && getSessionSnapshot().sessionEpoch === ctx.sessionEpoch;
    rememberMeta(result.data.id, {
      cachedAt: Date.now(),
      source: "server",
      verifiedForSession: verified,
    });
    seedNoteCache(result.data);
    if (ctx.scope) {
      void writeCachedNote(result.data, ctx.scope, ctx.sessionEpoch);
    }
    return result;
  }
  const fromIdb = await noteFromIdbResult(id, ctx);
  return fromIdb ?? result;
}

export async function loadNoteRecord(
  id: string,
  force = false,
): Promise<ApiResult<LoadedNote>> {
  const result = await loadNote(id, force);
  if (!result.ok) {
    return result;
  }
  const meta = getLoadedNoteMeta(id) ?? {
    cachedAt: Date.now(),
    source: "memory" as const,
    verifiedForSession: false,
  };
  return {
    data: { note: result.data, ...meta },
    ok: true,
  };
}

export async function loadNote(
  id: string,
  force = false,
): Promise<ApiResult<Note>> {
  const generation = nextRequestGeneration();
  noteGenerations.set(id, generation);
  const ctx: NoteLoadContext = {
    generation,
    id,
    scope: getHydratableScope(),
    sessionEpoch: getSessionSnapshot().sessionEpoch,
  };

  if (force) {
    noteInflight.delete(id);
  } else {
    const cached = noteCache.get(id);
    if (cached) {
      return okFromNote(cached, ctx, "memory", Date.now(), false);
    }
    const inflight = noteInflight.get(id);
    if (inflight) {
      return inflight;
    }
    if (ctx.scope) {
      const fromIdb = await hydrateNoteFromIdb(id, ctx.scope);
      if (fromIdb && matchesGeneration(ctx)) {
        const raw = await readCachedNote(ctx.scope, id);
        return okFromNote(
          fromIdb,
          ctx,
          "idb",
          raw?.cachedAt ?? Date.now(),
          false,
        );
      }
    }
  }

  const pending = fetchNote(id).then((result) =>
    finalizeNoteFetch(id, result, ctx, force),
  );
  noteInflight.set(id, pending);
  return await pending;
}

export function prefetchNote(id: string, signal?: AbortSignal): void {
  if (signal?.aborted) {
    return;
  }
  void loadNote(id).then((result) => {
    if (signal?.aborted) {
      return;
    }
    if (result.ok) {
      void loadOgCards(result.data.markdown);
    }
  });
}

export async function noteBodyNeedsPrefetch(
  id: string,
  scope: NonNullable<ReturnType<typeof getHydratableScope>>,
): Promise<boolean> {
  if (noteCache.has(id)) {
    return false;
  }
  return !(await hasCachedNoteBody(scope, id));
}

export function clearNoteInflight(): void {
  noteInflight.clear();
}

import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { Note, NoteSummary } from "@miyulabmd/shared";
import { indexedDB } from "fake-indexeddb";
import {
  getNotesLoadState,
  invalidateNotesCache,
  loadNotes,
  peekNotes,
  upsertNoteSummary,
} from "./list-cache.ts";
import { getLoadedNoteMeta, loadNote, peekNote } from "./note-cache.ts";
import {
  readCachedNotesList,
  writeCachedNote,
  writeCachedNotesList,
} from "./offline-cache.ts";
import {
  closeOfflineDb,
  configureOfflineDb,
  OFFLINE_DB_NAME,
  resetOfflineDbForTests,
  writeSessionRecord,
} from "./offline-db.ts";
import { evictNotesEverywhereImpl } from "./offline-evict.ts";
import {
  __testSetSessionState,
  getSessionSnapshot,
  registerPersistenceCleanup,
  resetOfflineSessionForTests,
} from "./offline-session.ts";
import {
  accountScopeFromUserId,
  nextRequestGeneration,
  type SessionEpoch,
} from "./offline-types.ts";

const scope = accountScopeFromUserId("user-a");
const epoch = 5 as SessionEpoch;

function note(id: string): NoteSummary {
  return {
    access: {
      effectiveReadScope: "self",
      effectiveWriteScope: "self",
      flags: { canAdmin: true, canEdit: true, canView: true },
      grants: [],
      inherit: true,
      readScope: null,
      source: "default",
      sourceFolder: null,
      writeScope: null,
    },
    alias: null,
    articleMeta: {},
    createdAt: 1,
    folder: "",
    folderId: null,
    id,
    ownerId: "user-a",
    permission: "private",
    shortId: id,
    title: id,
    updatedAt: 1,
  };
}

function fullNote(id: string): Note {
  return { ...note(id), markdown: `# ${id}` };
}

function mockNotesFetch(body: unknown, status = 200): void {
  mock.method(globalThis, "fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/notes") && !url.includes("/api/notes/")) {
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }
    if (url.match(/\/api\/notes\/.+/)) {
      const id = url.split("/").pop() ?? "";
      return Promise.resolve(
        new Response(JSON.stringify(fullNote(id)), { status: 200 }),
      );
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
}

afterEach(async () => {
  invalidateNotesCache();
  resetOfflineSessionForTests();
  resetOfflineDbForTests();
  closeOfflineDb();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  mock.restoreAll();
});

async function seedSession(
  status: Parameters<
    typeof __testSetSessionState
  >[0]["status"] = "online-confirmed",
) {
  configureOfflineDb({ indexedDB });
  await writeSessionRecord({
    confirmedAt: Date.now(),
    lastConfirmedUser: {
      displayName: "A",
      email: "a@example.com",
      id: "user-a",
    },
    offlineReadable: true,
    scope,
    sessionEpoch: epoch,
  });
  __testSetSessionState({
    offlineReadable: true,
    scope,
    sessionEpoch: epoch,
    status,
    user:
      status === "online-confirmed"
        ? { displayName: "A", email: "a@example.com", id: "user-a" }
        : null,
  });
}

test("hydrates notes list from IDB for readable scope", async () => {
  await seedSession("offline-known");
  await writeCachedNotesList([note("cached-a")], scope, epoch);
  mockNotesFetch({ notes: [note("server-b")] });

  const notes = await loadNotes(true);
  assert.deepEqual(
    notes.map((item) => item.id),
    ["server-b"],
  );
  assert.equal(getNotesLoadState(), "ready");
});

test("does not hydrate private IDB for unknown scope", async () => {
  await seedSession("unknown");
  __testSetSessionState({
    offlineReadable: false,
    scope: null,
    status: "unknown",
  });
  await writeCachedNotesList([note("private")], scope, epoch);
  mockNotesFetch({ notes: [note("online")] });

  const notes = await loadNotes(true);
  assert.deepEqual(
    notes.map((item) => item.id),
    ["online"],
  );
  assert.equal(
    peekNotes()?.some((item) => item.id === "private"),
    false,
  );
});

test("does not hydrate private IDB for unauthenticated", async () => {
  await seedSession("unauthenticated");
  __testSetSessionState({
    offlineReadable: false,
    scope: null,
    status: "unauthenticated",
  });
  await writeCachedNotesList([note("private")], scope, epoch);
  mockNotesFetch({ notes: [] });

  await loadNotes(true);
  const idb = await readCachedNotesList(scope);
  assert.equal(idb?.length, 1);
  assert.equal(getNotesLoadState(), "ready");
});

test("loadNotes failure without cache stays error and peekNotes null", async () => {
  await seedSession();
  mock.method(globalThis, "fetch", () =>
    Promise.resolve(new Response("fail", { status: 500 })),
  );
  const notes = await loadNotes(true);
  assert.deepEqual(notes, []);
  assert.equal(getNotesLoadState(), "error");
  assert.equal(peekNotes(), null);
});

test("loadNotes failure keeps existing cache", async () => {
  await seedSession();
  upsertNoteSummary(note("cached"));
  mock.method(globalThis, "fetch", () =>
    Promise.resolve(new Response("fail", { status: 500 })),
  );
  const notes = await loadNotes(true);
  assert.deepEqual(
    notes.map((item) => item.id),
    ["cached"],
  );
  assert.equal(getNotesLoadState(), "ready");
});

test("pre-hydrate upsert survives loadNotes", async () => {
  await seedSession();
  upsertNoteSummary(note("queued"));
  mockNotesFetch({ notes: [note("server")] });
  const notes = await loadNotes(true);
  assert.ok(notes.some((item) => item.id === "queued"));
});

test("stale fetch does not rewind newer loadNotes generation", async () => {
  await seedSession();
  let resolveSlow: (value: Response) => void = () => undefined;
  const slow = new Promise<Response>((resolve) => {
    resolveSlow = resolve;
  });
  let call = 0;
  mock.method(globalThis, "fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.includes("/api/notes")) {
      return Promise.reject(new Error(url));
    }
    call += 1;
    if (call === 1) {
      return slow;
    }
    return Promise.resolve(
      new Response(JSON.stringify({ notes: [note("new")] }), { status: 200 }),
    );
  });

  const first = loadNotes(true);
  const second = loadNotes(true);
  resolveSlow(
    new Response(JSON.stringify({ notes: [note("stale")] }), { status: 200 }),
  );
  await first;
  const notes = await second;
  assert.deepEqual(
    notes.map((item) => item.id),
    ["new"],
  );
});

test("loadNote IDB hit sets verifiedForSession false", async () => {
  await seedSession("offline-known");
  await writeCachedNote(fullNote("body-1"), scope, epoch);
  mock.method(globalThis, "fetch", () =>
    Promise.reject(new TypeError("offline")),
  );
  const result = await loadNote("body-1");
  assert.equal(result.ok, true);
  assert.equal(getLoadedNoteMeta("body-1")?.source, "idb");
  assert.equal(getLoadedNoteMeta("body-1")?.verifiedForSession, false);
});

test("loadNote force GET sets verifiedForSession true", async () => {
  await seedSession();
  mock.method(globalThis, "fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/notes/body-2")) {
      return Promise.resolve(
        new Response(JSON.stringify(fullNote("body-2")), { status: 200 }),
      );
    }
    return Promise.reject(new Error(url));
  });
  const result = await loadNote("body-2", true);
  assert.equal(result.ok, true);
  assert.equal(getLoadedNoteMeta("body-2")?.verifiedForSession, true);
  assert.equal(getLoadedNoteMeta("body-2")?.source, "server");
});

test("evictNotesEverywhere clears memory IDB and cleanup hook", async () => {
  await seedSession();
  await writeCachedNote(fullNote("evict-me"), scope, epoch);
  await writeCachedNotesList([note("evict-me")], scope, epoch);
  upsertNoteSummary(note("evict-me"));
  const removed: string[][] = [];
  registerPersistenceCleanup({
    removeNotePersistence: (_scope, ids) => {
      removed.push(ids);
    },
    removeScopePersistence: () => undefined,
  });

  await evictNotesEverywhereImpl(["evict-me"], "test", scope);
  assert.equal(peekNote("evict-me"), undefined);
  assert.equal(
    peekNotes()?.some((item) => item.id === "evict-me"),
    false,
  );
  assert.equal(await readCachedNotesList(scope), null);
  assert.ok(removed.length === 1);
  assert.ok(removed[0]?.includes("evict-me"));
});

test("prefetch skips notes that already have cached body", async () => {
  await seedSession();
  await writeCachedNote(fullNote("has-body"), scope, epoch);
  let noteFetches = 0;
  mock.method(globalThis, "fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/notes/has-body")) {
      noteFetches += 1;
      return Promise.resolve(
        new Response(JSON.stringify(fullNote("has-body")), { status: 200 }),
      );
    }
    if (url.includes("/api/notes")) {
      return Promise.resolve(
        new Response(JSON.stringify({ notes: [note("has-body")] }), {
          status: 200,
        }),
      );
    }
    return Promise.reject(new Error(url));
  });
  await loadNotes(true);
  assert.equal(noteFetches, 0);
});

test("different scope IDB is not used", async () => {
  const otherScope = accountScopeFromUserId("other");
  configureOfflineDb({ indexedDB });
  await writeSessionRecord({
    confirmedAt: Date.now(),
    lastConfirmedUser: null,
    offlineReadable: true,
    scope: otherScope,
    sessionEpoch: epoch,
  });
  await writeCachedNotesList([note("other-user")], otherScope, epoch);
  await seedSession();
  mockNotesFetch({ notes: [note("mine")] });
  const notes = await loadNotes(true);
  assert.deepEqual(
    notes.map((item) => item.id),
    ["mine"],
  );
});

void nextRequestGeneration();
void getSessionSnapshot();

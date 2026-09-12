import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { indexedDB } from "fake-indexeddb";
import { resetDraftJournalForTests } from "../lib/draft-journal.ts";
import { listDrafts, resetDraftStoreForTests } from "../lib/draft-store.ts";
import { peekNotes } from "../lib/list-cache.ts";
import {
  configureOfflineDb,
  OFFLINE_DB_NAME,
  resetOfflineDbForTests,
} from "../lib/offline-db.ts";
import {
  __testSetSessionState,
  resetOfflineSessionForTests,
} from "../lib/offline-session.ts";
import { accountScopeFromUserId } from "../lib/offline-types.ts";
import {
  persistNewNote,
  resetCreateNoteCoalescingForTests,
} from "./home-page.ts";

const user = {
  displayName: "Me",
  email: "me@example.com",
  id: "me",
};

afterEach(async () => {
  mock.restoreAll();
  resetDraftStoreForTests();
  resetDraftJournalForTests();
  resetOfflineDbForTests();
  resetOfflineSessionForTests();
  resetCreateNoteCoalescingForTests();
  await indexedDB.deleteDatabase(OFFLINE_DB_NAME);
});

test("persistNewNote coalesces same-tick double create into one draft", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    offlineReadable: true,
    scope: accountScopeFromUserId(user.id),
    status: "offline-known",
    user,
  });
  const navigate = mock.fn();
  const setCreating = mock.fn();
  const setError = mock.fn();
  await Promise.all([
    persistNewNote(null, navigate, setCreating, setError, user),
    persistNewNote(null, navigate, setCreating, setError, user),
  ]);
  const drafts = await listDrafts(user.id);
  assert.equal(drafts.length, 1);
  assert.equal(navigate.mock.callCount(), 2);
});

test("persistNewNote drafts only on network failure, not HTTP errors", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    offlineReadable: true,
    scope: accountScopeFromUserId(user.id),
    status: "online-confirmed",
    user,
  });
  mock.method(globalThis, "fetch", () =>
    Promise.resolve(new Response("bad", { status: 500 })),
  );
  const navigate = mock.fn();
  await persistNewNote(
    null,
    navigate,
    () => undefined,
    () => undefined,
    user,
    {
      dbBlocked: false,
      offlineReadable: true,
      pendingCleanup: false,
      pendingCleanupScope: null,
      scope: accountScopeFromUserId(user.id),
      sessionEpoch: 1 as import("../lib/offline-types.ts").SessionEpoch,
      status: "online-confirmed",
      user,
    },
  );
  assert.equal((await listDrafts(user.id)).length, 0);
  assert.equal(navigate.mock.callCount(), 0);
});

test("persistNewNote creates draft on network status 0", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    offlineReadable: true,
    scope: accountScopeFromUserId(user.id),
    status: "online-confirmed",
    user,
  });
  mock.method(globalThis, "fetch", () =>
    Promise.reject(new TypeError("offline")),
  );
  const navigate = mock.fn();
  await persistNewNote(
    null,
    navigate,
    () => undefined,
    () => undefined,
    user,
    {
      dbBlocked: false,
      offlineReadable: true,
      pendingCleanup: false,
      pendingCleanupScope: null,
      scope: accountScopeFromUserId(user.id),
      sessionEpoch: 1 as import("../lib/offline-types.ts").SessionEpoch,
      status: "online-confirmed",
      user,
    },
  );
  assert.equal((await listDrafts(user.id)).length, 1);
  assert.equal(navigate.mock.callCount(), 1);
});

test("persistNewNote does not write local id into notes cache", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    offlineReadable: true,
    scope: accountScopeFromUserId(user.id),
    status: "offline-known",
    user,
  });
  await persistNewNote(
    null,
    mock.fn(),
    () => undefined,
    () => undefined,
    user,
  );
  const ids = peekNotes()?.map((note) => note.id) ?? [];
  assert.equal(
    ids.some((id) => id.startsWith("local-")),
    false,
  );
});

test("guest session cannot create local draft", async () => {
  configureOfflineDb({ indexedDB });
  const setError = mock.fn<(message: string | null) => void>();
  await persistNewNote(null, mock.fn(), () => undefined, setError, null, {
    dbBlocked: false,
    offlineReadable: false,
    pendingCleanup: false,
    pendingCleanupScope: null,
    scope: null,
    sessionEpoch: 1 as import("../lib/offline-types.ts").SessionEpoch,
    status: "unknown",
    user: null,
  });
  assert.equal(setError.mock.callCount(), 1);
  assert.equal((await listDrafts("guest")).length, 0);
});

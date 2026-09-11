import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { FolderAccess, NoteSummary, SessionUser } from "@miyulabmd/shared";
import { indexedDB } from "fake-indexeddb";
import {
  invalidateFolderCache,
  invalidateNotesCache,
  peekNotes,
  seedFolderCache,
  upsertNoteSummary,
} from "../lib/list-cache.ts";
import {
  configureOfflineDb,
  OFFLINE_DB_NAME,
  resetOfflineDbForTests,
} from "../lib/offline-db.ts";
import { resetDraftJournalForTests } from "../lib/draft-journal.ts";
import { resetDraftStoreForTests } from "../lib/draft-store.ts";
import {
  __testSetSessionState,
  getSessionSnapshot,
  resetOfflineSessionForTests,
} from "../lib/offline-session.ts";
import { accountScopeFromUserId } from "../lib/offline-types.ts";
import {
  homeListFlags,
  homeRemoteMutationsBlocked,
  subscribeHomeFolder,
  subscribeHomeNotes,
} from "./home-page.ts";

function note(id: string, folderId: string | null = "folder-1"): NoteSummary {
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
    folder: "docs",
    folderId,
    id,
    ownerId: "me",
    permission: "private",
    shortId: id,
    title: id,
    updatedAt: 1,
  };
}

function folder(id: string, name = "docs"): FolderAccess {
  return {
    children: [],
    crumbs: [{ id, name }],
    effectiveReadScope: "self",
    effectiveWriteScope: "self",
    flags: { canAdmin: true, canEdit: true, canView: true },
    folder: name,
    grants: [],
    id,
    inherit: true,
    name,
    parentId: null,
    readScope: null,
    source: "default",
    sourceFolder: null,
    writeScope: null,
  };
}

const user: SessionUser = {
  displayName: "Me",
  email: "me@example.com",
  id: "me",
};

afterEach(async () => {
  invalidateNotesCache();
  invalidateFolderCache();
  resetDraftStoreForTests();
  resetDraftJournalForTests();
  resetOfflineSessionForTests();
  resetOfflineDbForTests();
  mock.restoreAll();
  await indexedDB.deleteDatabase(OFFLINE_DB_NAME);
});

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out");
}

test("homeRemoteMutationsBlocked is true for offline-known session", () => {
  __testSetSessionState({
    offlineReadable: true,
    scope: accountScopeFromUserId(user.id),
    status: "offline-known",
    user,
  });
  assert.equal(homeRemoteMutationsBlocked(getSessionSnapshot()), true);
});

test("homeListFlags keeps the tree visible while a folder is still loading", () => {
  const flags = homeListFlags({
    error: null,
    folderId: "folder-1",
    folderPending: false,
    notesError: false,
    notesLoadState: "ready",
    user,
    userLoading: false,
    visibleFolder: null,
  });
  assert.equal(flags.showPlaceholder, true);
  assert.equal(flags.showTree, true);
});

test("homeListFlags hides the tree when the folder failed to load", () => {
  const flags = homeListFlags({
    error: "フォルダが見つかりません。",
    folderId: "folder-1",
    folderPending: false,
    notesError: false,
    notesLoadState: "ready",
    user,
    userLoading: false,
    visibleFolder: null,
  });
  assert.equal(flags.showPlaceholder, false);
  assert.equal(flags.showTree, false);
});

test("subscribeHomeNotes keeps the list cache while refetching after a remount", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    offlineReadable: true,
    scope: accountScopeFromUserId(user.id),
    status: "online-confirmed",
    user,
  });
  upsertNoteSummary(note("keep-me"));
  const fetched = Promise.withResolvers<void>();
  mock.method(globalThis, "fetch", () => {
    fetched.resolve();
    return Promise.resolve(
      new Response(JSON.stringify({ notes: [note("fresh")] }), {
        status: 200,
      }),
    );
  });

  const setNotes = mock.fn<(notes: NoteSummary[]) => void>();
  const setNotesLoadState = mock.fn();
  const setNotesError = mock.fn();
  const unsubscribe = subscribeHomeNotes(
    false,
    user,
    null,
    setNotes,
    setNotesLoadState,
    setNotesError,
  );
  assert.deepEqual(
    peekNotes()?.map((item) => item.id),
    ["keep-me"],
  );
  if (setNotes.mock.callCount() > 0) {
    assert.deepEqual(
      setNotes.mock.calls[0]?.arguments[0].map((item) => item.id),
      ["keep-me"],
    );
  }

  await fetched.promise;
  await waitFor(() => setNotes.mock.callCount() > 0);
  assert.deepEqual(
    setNotes.mock.calls.at(-1)?.arguments[0].map((item) => item.id),
    ["keep-me", "fresh"],
  );
  unsubscribe?.();
});

test("homeListFlags shows notes placeholder while hydrating", () => {
  const flags = homeListFlags({
    error: null,
    folderId: undefined,
    folderPending: false,
    notesError: false,
    notesLoadState: "hydrating",
    user,
    userLoading: false,
    visibleFolder: folder("root"),
  });
  assert.equal(flags.notesPending, true);
  assert.equal(flags.showEmptyList, false);
});

test("homeListFlags distinguishes empty ready list from error", () => {
  const empty = homeListFlags({
    error: null,
    folderId: undefined,
    folderPending: false,
    notesError: false,
    notesLoadState: "ready",
    user,
    userLoading: false,
    visibleFolder: folder("root"),
  });
  assert.equal(empty.showEmptyList, true);
  assert.equal(empty.notesError, false);

  const failed = homeListFlags({
    error: null,
    folderId: undefined,
    folderPending: false,
    notesError: true,
    notesLoadState: "error",
    user,
    userLoading: false,
    visibleFolder: folder("root"),
  });
  assert.equal(failed.showEmptyList, false);
  assert.equal(failed.notesError, true);
});

test("subscribeHomeFolder shows the cached folder immediately and refreshes it", async () => {
  const cached = folder("folder-1");
  const next = { ...folder("folder-1"), name: "updated" };
  seedFolderCache(cached);
  const fetched = Promise.withResolvers<void>();
  mock.method(globalThis, "fetch", () => {
    fetched.resolve();
    return Promise.resolve(new Response(JSON.stringify(next), { status: 200 }));
  });

  const setVisibleFolder = mock.fn<(value: FolderAccess | null) => void>();
  const setPublicFolders = mock.fn();
  const setFolderPending = mock.fn<(pending: boolean) => void>();
  const setError = mock.fn<(error: string | null) => void>();
  const unsubscribe = subscribeHomeFolder("folder-1", user, false, {
    setError,
    setFolderPending,
    setPublicFolders,
    setVisibleFolder,
  });

  assert.equal(setVisibleFolder.mock.calls[0]?.arguments[0], cached);
  assert.equal(setFolderPending.mock.calls[0]?.arguments[0], false);

  await fetched.promise;
  await waitFor(
    () => setVisibleFolder.mock.calls.at(-1)?.arguments[0]?.name === "updated",
  );
  unsubscribe?.();
});

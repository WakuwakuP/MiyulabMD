import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Note, NoteSummary } from "@miyulabmd/shared";
import { indexedDB } from "fake-indexeddb";
import {
  __testReadRawCachedNote,
  hasCachedNoteBody,
  readCachedNote,
  readCachedNotesList,
  writeCachedNote,
  writeCachedNotesList,
} from "./offline-cache.ts";
import {
  configureOfflineDb,
  resetOfflineDbForTests,
  writeSessionRecord,
} from "./offline-db.ts";
import {
  __testSetSessionState,
  resetOfflineSessionForTests,
} from "./offline-session.ts";
import { accountScopeFromUserId, type SessionEpoch } from "./offline-types.ts";

const scope = accountScopeFromUserId("user-a");
const epoch = 1 as SessionEpoch;

function fullNote(id: string): Note {
  return {
    access: {
      effectiveReadScope: "self",
      effectiveWriteScope: "self",
      flags: { canAdmin: true, canEdit: true, canView: true },
      grants: [{ canWrite: true, email: "secret@example.com", userId: "u2" }],
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
    markdown: "# body",
    ownerId: "user-a",
    permission: "private",
    shortId: `short-${id}`,
    title: id,
    updatedAt: 2,
  };
}

function summary(id: string): NoteSummary {
  const { markdown: _m, ...rest } = fullNote(id);
  return rest;
}

afterEach(() => {
  resetOfflineDbForTests();
  resetOfflineSessionForTests();
});

test("writeCachedNote strips grants and email from IDB records", async () => {
  configureOfflineDb({ indexedDB });
  await writeSessionRecord({
    confirmedAt: Date.now(),
    lastConfirmedUser: null,
    offlineReadable: true,
    scope,
    sessionEpoch: epoch,
  });
  __testSetSessionState({
    scope,
    sessionEpoch: epoch,
    status: "online-confirmed",
  });

  const note = fullNote("note-1");
  assert.equal(await writeCachedNote(note, scope, epoch), true);

  const raw = (await __testReadRawCachedNote(scope, "note-1")) as Record<
    string,
    unknown
  >;
  assert.ok(raw);
  assert.equal("grants" in (raw.access as object), false);
  assert.equal(JSON.stringify(raw).includes("secret@example.com"), false);
});

test("writeCachedNote refuses local-* ids", async () => {
  configureOfflineDb({ indexedDB });
  await writeSessionRecord({
    confirmedAt: Date.now(),
    lastConfirmedUser: null,
    offlineReadable: true,
    scope,
    sessionEpoch: epoch,
  });
  const local = fullNote("local-draft");
  assert.equal(await writeCachedNote(local, scope, epoch), false);
  assert.equal(await hasCachedNoteBody(scope, "local-draft"), false);
});

test("readCachedNotesList hydrates summaries for the same scope", async () => {
  configureOfflineDb({ indexedDB });
  await writeSessionRecord({
    confirmedAt: Date.now(),
    lastConfirmedUser: null,
    offlineReadable: true,
    scope,
    sessionEpoch: epoch,
  });
  await writeCachedNotesList([summary("a"), summary("b")], scope, epoch);
  const list = await readCachedNotesList(scope);
  assert.deepEqual(
    list?.map((item) => item.id),
    ["a", "b"],
  );
  assert.deepEqual(list?.[0]?.access.grants, []);
});

test("readCachedNote resolves shortId index", async () => {
  configureOfflineDb({ indexedDB });
  await writeSessionRecord({
    confirmedAt: Date.now(),
    lastConfirmedUser: null,
    offlineReadable: true,
    scope,
    sessionEpoch: epoch,
  });
  await writeCachedNote(fullNote("note-1"), scope, epoch);
  const byShort = await readCachedNote(scope, "short-note-1");
  assert.equal(byShort?.id, "note-1");
});

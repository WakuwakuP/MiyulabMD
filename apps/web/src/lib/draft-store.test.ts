import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { indexedDB } from "fake-indexeddb";
import {
  configureOfflineDb,
  OFFLINE_DB_NAME,
  resetOfflineDbForTests,
} from "./offline-db.ts";
import { resetDraftJournalForTests } from "./draft-journal.ts";
import {
  deleteDraft,
  insertDraft,
  listDrafts,
  resetDraftStoreForTests,
  saveDraft,
  type LocalDraft,
} from "./draft-store.ts";
import { nextLockEpoch, nextSessionEpoch } from "./offline-types.ts";
import { writeSessionRecord } from "./offline-db.ts";

const ownerId = "user-1";

function sampleDraft(revision = 1, localId = "local-abc"): LocalDraft {
  const now = Date.now();
  return {
    createdAt: now,
    folder: "",
    inheritAccess: true,
    kind: "draft",
    localId: localId as `local-${string}`,
    markdown: "# 無題\n",
    ownerId,
    revision,
    updatedAt: now,
  };
}

afterEach(async () => {
  resetDraftStoreForTests();
  resetDraftJournalForTests();
  resetOfflineDbForTests();
  await indexedDB.deleteDatabase(OFFLINE_DB_NAME);
});

test("saveDraft rejects stale revision overwrites", async () => {
  configureOfflineDb({ indexedDB });
  await writeSessionRecord({
    lastConfirmedUser: null,
    offlineReadable: true,
    scope: `user:${ownerId}`,
    sessionEpoch: nextSessionEpoch(),
  });
  const draft = sampleDraft(2);
  assert.equal(await insertDraft(draft), true);
  const sessionEpoch = nextSessionEpoch();
  await writeSessionRecord({
    confirmedAt: Date.now(),
    lastConfirmedUser: {
      displayName: "User",
      email: "u@example.com",
      id: ownerId,
    },
    offlineReadable: true,
    scope: `user:${ownerId}`,
    sessionEpoch,
  });
  const stale = await saveDraft({
    folder: "",
    localId: draft.localId,
    lockEpoch: nextLockEpoch(),
    markdown: "# 更新\n",
    ownerId,
    revision: 1,
    sessionEpoch,
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.reason, "stale-revision");
  }
  const current = (await listDrafts(ownerId))[0];
  assert.equal(current?.markdown, "# 無題\n");
});

test("saveDraft rejects resurrection after delete", async () => {
  configureOfflineDb({ indexedDB });
  const draft = sampleDraft(1, "local-deleted");
  assert.equal(await insertDraft(draft), true);
  await deleteDraft(ownerId, draft.localId);
  const sessionEpoch = nextSessionEpoch();
  await writeSessionRecord({
    confirmedAt: Date.now(),
    lastConfirmedUser: {
      displayName: "User",
      email: "u@example.com",
      id: ownerId,
    },
    offlineReadable: true,
    scope: `user:${ownerId}`,
    sessionEpoch,
  });
  const revived = await saveDraft({
    folder: "",
    localId: draft.localId,
    lockEpoch: nextLockEpoch(),
    markdown: "# 復活\n",
    ownerId,
    revision: 2,
    sessionEpoch,
  });
  assert.equal(revived.ok, false);
  if (!revived.ok) {
    assert.equal(revived.reason, "deleted");
  }
  assert.equal((await listDrafts(ownerId)).length, 0);
});

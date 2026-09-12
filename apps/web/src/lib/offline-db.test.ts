import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { indexedDB } from "fake-indexeddb";
import {
  closeOfflineDb,
  configureOfflineDb,
  OFFLINE_DB_NAME,
  openDb,
  readSessionRecord,
  resetOfflineDbForTests,
  writeSessionRecord,
} from "./offline-db.ts";
import type { SessionEpoch } from "./offline-types.ts";

afterEach(() => {
  resetOfflineDbForTests();
});

test("openDb returns null when indexedDB.open throws", async () => {
  configureOfflineDb({
    indexedDB: {
      open: () => {
        throw new Error("open failed");
      },
    } as unknown as IDBFactory,
  });
  const db = await openDb();
  assert.equal(db, null);
});

test("openDb opens miyulabmd-offline with notes lists session stores", async () => {
  configureOfflineDb({ indexedDB });
  const db = await openDb();
  assert.ok(db);
  assert.equal(db.name, OFFLINE_DB_NAME);
  assert.ok(db.objectStoreNames.contains("notes"));
  assert.ok(db.objectStoreNames.contains("lists"));
  assert.ok(db.objectStoreNames.contains("session"));
  assert.ok(db.objectStoreNames.contains("draft-journal"));
  assert.ok(db.objectStoreNames.contains("draft-promotions"));
  closeOfflineDb();
});

test("writeSessionRecord and readSessionRecord round-trip", async () => {
  configureOfflineDb({ indexedDB });
  const epoch = 3 as SessionEpoch;
  const written = await writeSessionRecord({
    confirmedAt: 100,
    lastConfirmedUser: {
      displayName: "A",
      email: "a@example.com",
      id: "u1",
    },
    offlineReadable: true,
    scope: "user:u1",
    sessionEpoch: epoch,
  });
  assert.equal(written, true);
  const record = await readSessionRecord();
  assert.equal(record?.scope, "user:u1");
  assert.equal(record?.sessionEpoch, epoch);
});

test("openDb reuses a single connection", async () => {
  configureOfflineDb({ indexedDB });
  const first = await openDb();
  const second = await openDb();
  assert.equal(first, second);
  closeOfflineDb();
});

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { IDBKeyRange, indexedDB } from "fake-indexeddb";
import * as Y from "yjs";
import {
  __testCountUpdates,
  __testDatabaseExists,
  __testMarkCatalogPendingDelete,
  __testOpenNoteDb,
  __testReadCheckpointMeta,
  __testUpdateCatalogGeneration,
  buildNoteDbName,
  CATALOG_DB_NAME,
  clearDocument,
  configureCollaborationPersistence,
  deleteNotePersistence,
  deleteScopePersistence,
  installYjsPersistenceCleanup,
  listCatalog,
  openNotePersistence,
  resetCollaborationPersistenceForTests,
  retryPendingDeletes,
} from "./collaboration-persistence.ts";
import {
  registerPersistenceCleanup,
  resetOfflineSessionForTests,
} from "./offline-session.ts";
import {
  accountScopeFromUserId,
  nextRequestGeneration,
} from "./offline-types.ts";

const scope = accountScopeFromUserId("user-a");
const noteId = "11111111-1111-4111-8111-111111111111";

let previousKeyRange: typeof globalThis.IDBKeyRange | undefined;

function useFakeIndexedDb(): void {
  previousKeyRange = globalThis.IDBKeyRange;
  globalThis.IDBKeyRange = IDBKeyRange as typeof globalThis.IDBKeyRange;
  configureCollaborationPersistence({ indexedDB });
}

function restoreFakeIndexedDb(): void {
  if (previousKeyRange !== undefined) {
    globalThis.IDBKeyRange = previousKeyRange;
    previousKeyRange = undefined;
  }
}

async function deleteAllDbs(): Promise<void> {
  const catalog = await listCatalog();
  for (const entry of catalog) {
    await clearDocument(entry.dbName);
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(CATALOG_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

afterEach(async () => {
  resetCollaborationPersistenceForTests();
  restoreFakeIndexedDb();
  resetOfflineSessionForTests();
  await deleteAllDbs();
});

test("registers catalog entry when openNotePersistence succeeds", async () => {
  useFakeIndexedDb();
  const generation = nextRequestGeneration();
  const doc = new Y.Doc();
  doc.getText("markdown").insert(0, "hello");

  const persistence = await openNotePersistence({
    doc,
    generation,
    noteId,
    scope,
  });
  assert.ok(persistence);

  const catalog = await listCatalog();
  assert.equal(catalog.length, 1);
  assert.equal(catalog[0]?.noteId, noteId);
  assert.equal(catalog[0]?.generation, generation);
  assert.equal(catalog[0]?.dbName, buildNoteDbName(scope, noteId));
  await persistence.destroy();
});

test("checkpoint resolves true only after transaction completes", async () => {
  useFakeIndexedDb();
  const doc = new Y.Doc();
  doc.getText("markdown").insert(0, "one");
  const persistence = await openNotePersistence({
    doc,
    generation: nextRequestGeneration(),
    noteId,
    scope,
  });
  assert.ok(persistence);
  await persistence.whenSynced;

  doc.getText("markdown").insert(3, "!");
  const ok = await persistence.checkpoint();
  assert.equal(ok, true);

  const dbName = buildNoteDbName(scope, noteId);
  const meta = await __testReadCheckpointMeta(dbName);
  assert.ok(meta.checkpointKeys.length >= 1);
  await persistence.destroy();
});

test("unchanged checkpoint does not append updates", async () => {
  useFakeIndexedDb();
  const doc = new Y.Doc();
  doc.getText("markdown").insert(0, "stable");
  const persistence = await openNotePersistence({
    doc,
    generation: nextRequestGeneration(),
    noteId,
    scope,
  });
  assert.ok(persistence);
  await persistence.whenSynced;

  assert.equal(await persistence.checkpoint(), true);
  const dbName = buildNoteDbName(scope, noteId);
  const before = await __testReadCheckpointMeta(dbName);
  const updatesBefore = await __testCountUpdates(dbName);

  assert.equal(await persistence.checkpoint(), true);
  const after = await __testReadCheckpointMeta(dbName);
  const updatesAfter = await __testCountUpdates(dbName);

  assert.deepEqual(after.checkpointKeys, before.checkpointKeys);
  assert.equal(updatesAfter, updatesBefore);
  await persistence.destroy();
});

test("compaction keeps document restorable after many checkpoints", async () => {
  useFakeIndexedDb();
  const doc = new Y.Doc();
  const ytext = doc.getText("markdown");
  const generation = nextRequestGeneration();
  const persistence = await openNotePersistence({
    doc,
    generation,
    noteId,
    scope,
  });
  assert.ok(persistence);
  await persistence.whenSynced;

  for (let i = 0; i < 65; i++) {
    ytext.insert(ytext.length, `${i}`);
    assert.equal(await persistence.checkpoint(), true);
  }

  await persistence.destroy();

  const restored = new Y.Doc();
  const reopened = await openNotePersistence({
    doc: restored,
    generation,
    noteId,
    scope,
  });
  assert.ok(reopened);
  await reopened.whenSynced;
  assert.equal(restored.getText("markdown").toString(), ytext.toString());
  await reopened.destroy();
});

test("deleteNotePersistence waits for deleteDatabase completion", async () => {
  useFakeIndexedDb();
  const doc = new Y.Doc();
  const generation = nextRequestGeneration();
  const dbName = buildNoteDbName(scope, noteId);
  const persistence = await openNotePersistence({
    doc,
    generation,
    noteId,
    scope,
  });
  assert.ok(persistence);
  await persistence.whenSynced;
  await persistence.destroy();

  await deleteNotePersistence(scope, [noteId]);
  assert.equal(await __testDatabaseExists(dbName), false);
  assert.equal((await listCatalog()).length, 0);
});

test("retryPendingDeletes removes catalog rows marked pendingDelete", async () => {
  useFakeIndexedDb();
  const doc = new Y.Doc();
  const generation = nextRequestGeneration();
  const dbName = buildNoteDbName(scope, noteId);
  const persistence = await openNotePersistence({
    doc,
    generation,
    noteId,
    scope,
  });
  assert.ok(persistence);
  await persistence.whenSynced;
  await persistence.destroy();

  await __testMarkCatalogPendingDelete(scope, noteId);
  assert.equal((await listCatalog())[0]?.pendingDelete, true);

  await retryPendingDeletes();
  assert.equal((await listCatalog()).length, 0);
  assert.equal(await __testDatabaseExists(dbName), false);
});

test("stale generation open does not apply persisted doc to caller", async () => {
  useFakeIndexedDb();
  const generation1 = nextRequestGeneration();
  const generation2 = nextRequestGeneration();
  const doc = new Y.Doc();
  doc.getText("markdown").insert(0, "seed");

  const first = await openNotePersistence({
    doc,
    generation: generation1,
    noteId,
    scope,
  });
  assert.ok(first);
  await first.whenSynced;
  await first.checkpoint();
  await first.destroy();

  await __testUpdateCatalogGeneration(scope, noteId, generation2);

  const staleDoc = new Y.Doc();
  staleDoc.getText("markdown").insert(0, "caller");
  const stale = await openNotePersistence({
    doc: staleDoc,
    generation: generation1,
    noteId,
    scope,
  });
  assert.equal(stale, null);
  assert.equal(staleDoc.getText("markdown").toString(), "caller");
});

test("deleteScopePersistence removes all note DBs for scope", async () => {
  useFakeIndexedDb();
  const noteB = "22222222-2222-4222-8222-222222222222";
  const generation = nextRequestGeneration();

  for (const id of [noteId, noteB]) {
    const doc = new Y.Doc();
    const persistence = await openNotePersistence({
      doc,
      generation,
      noteId: id,
      scope,
    });
    assert.ok(persistence);
    await persistence.whenSynced;
    await persistence.destroy();
  }

  await deleteScopePersistence(scope);
  assert.equal((await listCatalog()).length, 0);
  assert.equal(
    await __testDatabaseExists(buildNoteDbName(scope, noteId)),
    false,
  );
  assert.equal(
    await __testDatabaseExists(buildNoteDbName(scope, noteB)),
    false,
  );
});

test("stores Yjs updates only — not note grants or markdown in offline notes shape", async () => {
  useFakeIndexedDb();
  const doc = new Y.Doc();
  doc.getText("markdown").insert(0, "# Title\n\nBody");
  const persistence = await openNotePersistence({
    doc,
    generation: nextRequestGeneration(),
    noteId,
    scope,
  });
  assert.ok(persistence);
  await persistence.whenSynced;
  await persistence.checkpoint();

  const dbName = buildNoteDbName(scope, noteId);
  const db = await __testOpenNoteDb(dbName);
  assert.ok(db);
  assert.ok(db.objectStoreNames.contains("updates"));
  assert.ok(db.objectStoreNames.contains("custom"));
  assert.equal(db.objectStoreNames.contains("notes"), false);

  const forbidden = ["grants", "effectiveReadScope", '"markdown":'];
  for (const storeName of ["updates", "custom"] as const) {
    const values = await new Promise<unknown[]>((resolve) => {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result ?? []);
      tx.oncomplete = () => db.close();
    });
    for (const value of values) {
      const serialized = JSON.stringify(value);
      for (const token of forbidden) {
        assert.ok(
          !serialized.includes(token),
          `unexpected offline note field ${token} in ${storeName}`,
        );
      }
    }
  }

  const catalog = await listCatalog();
  assert.equal(catalog.length, 1);
  const entry = catalog[0];
  assert.ok(entry);
  assert.ok(!("markdown" in entry));
  assert.ok(!("grants" in entry));
  await persistence.destroy();
});

test("installYjsPersistenceCleanup is idempotent", () => {
  useFakeIndexedDb();
  installYjsPersistenceCleanup();
  installYjsPersistenceCleanup();
  registerPersistenceCleanup({
    removeNotePersistence: () => undefined,
    removeScopePersistence: () => undefined,
  });
});

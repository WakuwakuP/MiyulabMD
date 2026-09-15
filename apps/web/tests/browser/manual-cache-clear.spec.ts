import { expect, test } from "@playwright/test";
import { note } from "./fixtures/note.ts";

const appRoot = "miyulabmd-offline-cache-v1";

test("clears every user's private device cache while retaining viewer and shell", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/storage.html");
  const result = await page.evaluate(async (source) => {
    const {
      clearOfflineCacheDevice,
      captureOfflineCacheScope,
      openOfflineCache,
      persistCachedViewerId,
      readCachedViewerId,
    } = await import("/src/lib/offline-cache.ts");
    const alice = await openOfflineCache({ userId: "manual-alice-1" });
    const bob = await openOfflineCache({ userId: "manual-bob-1" });
    const aliceNote = {
      ...source,
      id: "manual-alice-note-1",
      ownerId: "manual-alice-1",
    };
    const bobNote = {
      ...source,
      id: "manual-bob-note-1",
      ownerId: "manual-bob-1",
    };
    const { markdown: _markdown, ...summary } = aliceNote;
    const folder = {
      ...source.access,
      children: [],
      crumbs: [],
      folder: "",
      id: "manual-root-1",
      parentId: null,
    };
    await alice.putNote(aliceNote);
    await alice.putNoteList([summary]);
    await alice.putFolder(folder, { asDriveRoot: true });
    await alice.putImage(
      aliceNote.id,
      "manual-image-1",
      new Blob(["alice"], { type: "image/png" }),
    );
    await bob.putNote(bobNote);
    await bob.putImage(
      bobNote.id,
      "manual-image-2",
      new Blob(["bob"], { type: "image/png" }),
    );
    await persistCachedViewerId("manual-alice-1");
    const shell = await caches.open("manual-device-shell-1");
    await shell.put("/manual-shell", new Response("retained"));
    const aliceScope = await captureOfflineCacheScope("manual-alice-1");
    const bobScope = await captureOfflineCacheScope("manual-bob-1");
    try {
      await clearOfflineCacheDevice();
      const root = await navigator.storage.getDirectory();
      const app = await root.getDirectoryHandle(appRoot);
      const exists = async (id: string) =>
        app.getDirectoryHandle(btoa(id).replace(/[=]+$/, "")).then(
          () => true,
          () => false,
        );
      const stale = await alice.putNote(aliceNote).then(
        () => false,
        () => true,
      );
      const scoped = await openOfflineCache({
        scope: aliceScope,
        userId: aliceScope.userId,
      }).then(
        (value) => {
          value.close();
          return false;
        },
        () => true,
      );
      const fresh = await openOfflineCache({ userId: "manual-alice-1" });
      const freshBob = await openOfflineCache({ userId: "manual-bob-1" });
      try {
        const afterClear = {
          bobNote: await freshBob.getNote(bobNote.id),
          folder: await fresh.getFolder(null),
          list: await fresh.getNoteList(),
          note: await fresh.getNote(aliceNote.id),
        };
        await fresh.putNote({ ...aliceNote, markdown: "fresh device recache" });
        return {
          afterClear,
          alice: await exists("manual-alice-1"),
          bob: await exists("manual-bob-1"),
          bobScope: await openOfflineCache({
            scope: bobScope,
            userId: bobScope.userId,
          }).then(
            (value) => {
              value.close();
              return false;
            },
            () => true,
          ),
          note: (await fresh.getNote(aliceNote.id))?.note.markdown,
          remembered: await readCachedViewerId(),
          scoped,
          shell: await (await shell.match("/manual-shell"))?.text(),
          stale,
        };
      } finally {
        fresh.close();
        freshBob.close();
      }
    } finally {
      alice.close();
      bob.close();
    }
  }, note);
  expect(result).toEqual({
    afterClear: { bobNote: null, folder: null, list: null, note: null },
    alice: true,
    bob: false,
    bobScope: true,
    folder: null,
    list: null,
    note: "fresh device recache",
    remembered: "manual-alice-1",
    scoped: true,
    shell: "retained",
    stale: true,
  });
});

test("waits for an unknown-user note write before completing device clear", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/storage.html");
  const result = await page.evaluate(async (source) => {
    const { clearOfflineCacheDevice, openOfflineCache } = await import(
      "/src/lib/offline-cache.ts"
    );
    const cache = await openOfflineCache({ userId: "manual-unknown-note-2" });
    const original = FileSystemFileHandle.prototype.createWritable;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      const writable = await original.apply(this, args);
      const close = writable.close.bind(writable);
      writable.close = async () => {
        await close();
        entered.resolve();
        await release.promise;
      };
      return writable;
    };
    try {
      const writing = cache
        .putNote({ ...source, id: "manual-unknown-note-2" })
        .then(
          () => true,
          () => false,
        );
      await entered.promise;
      const clearing = clearOfflineCacheDevice();
      let settled = false;
      void clearing.then(() => {
        settled = true;
      });
      await Promise.resolve();
      release.resolve();
      return {
        blockedBeforeRelease: !settled,
        cleared: await clearing.then(() => true),
        exists: await (async () => {
          try {
            const root = await navigator.storage.getDirectory();
            const app = await root.getDirectoryHandle(appRoot);
            await app.getDirectoryHandle(
              btoa("manual-unknown-note-2").replace(/[=]+$/, ""),
            );
            return true;
          } catch {
            return false;
          }
        })(),
        written: await writing,
      };
    } finally {
      release.resolve();
      FileSystemFileHandle.prototype.createWritable = original;
      cache.close();
    }
  }, note);
  expect(result).toEqual({
    blockedBeforeRelease: true,
    cleared: true,
    exists: false,
    written: false,
  });
});

test("waits for an unknown-user image write before completing device clear", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/storage.html");
  const result = await page.evaluate(async () => {
    const { clearOfflineCacheDevice, openOfflineCache } = await import(
      "/src/lib/offline-cache.ts"
    );
    const cache = await openOfflineCache({ userId: "manual-unknown-image-3" });
    const original = FileSystemFileHandle.prototype.createWritable;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    FileSystemFileHandle.prototype.createWritable = async function (...args) {
      const writable = await original.apply(this, args);
      const close = writable.close.bind(writable);
      writable.close = async () => {
        await close();
        entered.resolve();
        await release.promise;
      };
      return writable;
    };
    try {
      const writing = cache
        .putImage(
          "manual-image-note-3",
          "manual-image-3",
          new Blob(["image"], { type: "image/png" }),
        )
        .then(
          () => true,
          () => false,
        );
      await entered.promise;
      const clearing = clearOfflineCacheDevice();
      let settled = false;
      void clearing.then(() => {
        settled = true;
      });
      await Promise.resolve();
      release.resolve();
      return {
        blockedBeforeRelease: !settled,
        cleared: await clearing.then(() => true),
        written: await writing,
      };
    } finally {
      release.resolve();
      FileSystemFileHandle.prototype.createWritable = original;
      cache.close();
    }
  });
  expect(result).toEqual({
    blockedBeforeRelease: true,
    cleared: true,
    written: false,
  });
});

test("keeps device cache purging and suspended after OPFS failure until retry", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/storage.html");
  const result = await page.evaluate(async (source) => {
    const { clearOfflineCacheDevice, openOfflineCache } = await import(
      "/src/lib/offline-cache.ts"
    );
    const cache = await openOfflineCache({ userId: "manual-opfs-failure-4" });
    await cache.putNote({ ...source, id: "manual-opfs-note-4" });
    const original = FileSystemDirectoryHandle.prototype.removeEntry;
    let fail = true;
    FileSystemDirectoryHandle.prototype.removeEntry = function (name, options) {
      if (name === appRoot && fail) {
        throw new DOMException("blocked", "NotAllowedError");
      }
      return original.call(this, name, options);
    };
    const readState = async () =>
      new Promise<string | null>((resolve, reject) => {
        const request = indexedDB.open("miyulabmd-offline-cache");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const get = db
            .transaction("metadata")
            .objectStore("metadata")
            .get("device-clear-state");
          get.onsuccess = () => {
            db.close();
            resolve(
              (get.result as { value?: string } | undefined)?.value ?? null,
            );
          };
          get.onerror = () => {
            db.close();
            reject(get.error);
          };
        };
      });
    try {
      const failed = await clearOfflineCacheDevice().then(
        () => false,
        () => true,
      );
      const purging = await readState();
      const suspended = await openOfflineCache({
        userId: "manual-opfs-failure-4",
      }).then(
        (value) => {
          value.close();
          return false;
        },
        () => true,
      );
      fail = false;
      await clearOfflineCacheDevice();
      return { active: await readState(), failed, purging, suspended };
    } finally {
      FileSystemDirectoryHandle.prototype.removeEntry = original;
      cache.close();
    }
  }, note);
  expect(result.failed).toBe(true);
  expect(result.purging).toBe("purging");
  expect(result.suspended).toBe(true);
  expect(result.active).toBe("active");
});

test("records durable purging before an IDB failure and retries device clear", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/storage.html");
  const result = await page.evaluate(async () => {
    const { clearOfflineCacheDevice, openOfflineCache } = await import(
      "/src/lib/offline-cache.ts"
    );
    const cache = await openOfflineCache({ userId: "manual-idb-failure-5" });
    const original = IDBObjectStore.prototype.clear;
    let fail = true;
    let opfsRemovals = 0;
    const remove = FileSystemDirectoryHandle.prototype.removeEntry;
    IDBObjectStore.prototype.clear = function () {
      if (fail && ["notes", "folders", "note-lists"].includes(this.name)) {
        throw new DOMException("blocked", "QuotaExceededError");
      }
      return original.call(this);
    };
    FileSystemDirectoryHandle.prototype.removeEntry = function (name, options) {
      if (name === appRoot) {
        opfsRemovals++;
      }
      return remove.call(this, name, options);
    };
    const readState = async () =>
      new Promise<string | null>((resolve, reject) => {
        const request = indexedDB.open("miyulabmd-offline-cache");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const get = db
            .transaction("metadata")
            .objectStore("metadata")
            .get("device-clear-state");
          get.onsuccess = () => {
            db.close();
            resolve(
              (get.result as { value?: string } | undefined)?.value ?? null,
            );
          };
          get.onerror = () => {
            db.close();
            reject(get.error);
          };
        };
      });
    try {
      const failed = await clearOfflineCacheDevice().then(
        () => false,
        () => true,
      );
      const first = { failed, opfsRemovals, state: await readState() };
      fail = false;
      await clearOfflineCacheDevice();
      return {
        ...first,
        active: await readState(),
        opfsRemovalsAfterRetry: opfsRemovals,
      };
    } finally {
      IDBObjectStore.prototype.clear = original;
      FileSystemDirectoryHandle.prototype.removeEntry = remove;
      cache.close();
    }
  });
  expect(result).toEqual({
    active: "active",
    failed: true,
    opfsRemovals: 0,
    opfsRemovalsAfterRetry: 1,
    state: "purging",
  });
});

test("abort after the purging marker completes terminally without implicit retry", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/storage.html");
  const result = await page.evaluate(async () => {
    const { clearOfflineCacheDevice } = await import(
      "/src/lib/offline-cache.ts"
    );
    const controller = new AbortController();
    const entered = Promise.withResolvers<void>();
    const original = IDBObjectStore.prototype.clear;
    let clears = 0;
    IDBObjectStore.prototype.clear = function () {
      if (this.name === "notes" && clears++ === 0) {
        entered.resolve();
      }
      return original.call(this);
    };
    try {
      const operation = clearOfflineCacheDevice({
        signal: controller.signal,
      }).then(
        () => "completed",
        () => "rejected",
      );
      await entered.promise;
      controller.abort(new Error("cancel after marker"));
      const terminal = await operation;
      return { clearCalls: clears, terminal };
    } finally {
      IDBObjectStore.prototype.clear = original;
    }
  });
  expect(result).toEqual({ clearCalls: 3, terminal: "completed" });
});

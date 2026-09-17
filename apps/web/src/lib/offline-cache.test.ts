import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { FolderAccess, Note, NoteSummary } from "@miyulabmd/shared";

// ---------------------------------------------------------------------------
// Minimal IndexedDB + OPFS harness.
// Node 24 provides real navigator.locks/DOMException/crypto, so purge
// arbitration is exercised for real; only storage backends are faked.
// ---------------------------------------------------------------------------

type StoreData = Map<string, unknown>;

class FakeIDBRequest {
  error: DOMException | null = null;
  onerror: (() => void) | null = null;
  onsuccess: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  result: unknown;
}

class FakeCursor {
  private readonly request: FakeIDBRequest;
  private readonly transaction: FakeTransaction;
  private readonly data: StoreData;
  private readonly keys: string[];
  private readonly index: number;

  constructor(
    request: FakeIDBRequest,
    transaction: FakeTransaction,
    data: StoreData,
    keys: string[],
    index: number,
  ) {
    this.request = request;
    this.transaction = transaction;
    this.data = data;
    this.keys = keys;
    this.index = index;
  }

  get key(): string {
    return this.keys[this.index] as string;
  }

  get value(): unknown {
    return structuredClone(this.data.get(this.keys[this.index] as string));
  }

  continue(): void {
    const nextIndex = this.index + 1;
    this.transaction.schedule(() => {
      this.request.result =
        nextIndex < this.keys.length
          ? new FakeCursor(
              this.request,
              this.transaction,
              this.data,
              this.keys,
              nextIndex,
            )
          : null;
      this.request.onsuccess?.();
    });
  }

  delete(): void {
    this.data.delete(this.keys[this.index] as string);
  }
}

type KeyRange = { lower: string; upper: string };

function inRange(key: string, range?: KeyRange): boolean {
  return !range || (key >= range.lower && key <= range.upper);
}

class FakeObjectStore {
  private readonly transaction: FakeTransaction;
  readonly name: string;
  private readonly data: StoreData;

  constructor(transaction: FakeTransaction, name: string, data: StoreData) {
    this.transaction = transaction;
    this.name = name;
    this.data = data;
  }

  get(key: string): FakeIDBRequest {
    const request = new FakeIDBRequest();
    this.transaction.schedule(() => {
      request.result = structuredClone(this.data.get(key));
      request.onsuccess?.();
    });
    return request;
  }

  getAll(range?: KeyRange): FakeIDBRequest {
    const request = new FakeIDBRequest();
    this.transaction.schedule(() => {
      request.result = [...this.data.keys()]
        .filter((key) => inRange(key, range))
        .sort()
        .map((key) => structuredClone(this.data.get(key)));
      request.onsuccess?.();
    });
    return request;
  }

  put(record: { key: string }): FakeIDBRequest {
    const request = new FakeIDBRequest();
    this.transaction.schedule(() => {
      this.data.set(record.key, structuredClone(record));
      request.onsuccess?.();
    });
    return request;
  }

  delete(key: string): FakeIDBRequest {
    const request = new FakeIDBRequest();
    this.transaction.schedule(() => {
      this.data.delete(key);
      request.onsuccess?.();
    });
    return request;
  }

  clear(): FakeIDBRequest {
    const request = new FakeIDBRequest();
    this.transaction.schedule(() => {
      this.data.clear();
      request.onsuccess?.();
    });
    return request;
  }

  openCursor(range?: KeyRange): FakeIDBRequest {
    const request = new FakeIDBRequest();
    const keys = [...this.data.keys()]
      .filter((key) => inRange(key, range))
      .sort();
    this.transaction.schedule(() => {
      request.result = keys.length
        ? new FakeCursor(request, this.transaction, this.data, keys, 0)
        : null;
      request.onsuccess?.();
    });
    return request;
  }
}

class FakeTransaction {
  private readonly snapshots = new Map<string, StoreData>();
  private pending = 0;
  private settled = false;
  private aborted = false;
  private readonly backend: FakeBackend;
  readonly mode: string;
  error: DOMException | null = null;
  onabort: (() => void) | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(backend: FakeBackend, storeNames: string[], mode: string) {
    this.backend = backend;
    this.mode = mode;
    for (const name of storeNames) {
      const store = this.backend.stores.get(name);
      if (!store) {
        throw new DOMException(
          `Object store ${name} not found`,
          "NotFoundError",
        );
      }
      this.snapshots.set(name, new Map(store));
    }
    // An empty transaction commits on the next turn.
    queueMicrotask(() => this.check());
  }

  objectStore(name: string): FakeObjectStore {
    const data = this.snapshots.get(name);
    if (!data) {
      throw new DOMException(`Object store ${name} not found`, "NotFoundError");
    }
    return new FakeObjectStore(this, name, data);
  }

  schedule(run: () => void): void {
    this.pending += 1;
    queueMicrotask(() => {
      try {
        if (!(this.aborted || this.settled)) {
          run();
        }
      } catch (error) {
        this.abort(
          error instanceof DOMException
            ? error
            : new DOMException("Request failed", "UnknownError"),
        );
      }
      this.pending -= 1;
      this.check();
    });
  }

  abort(error?: DOMException): void {
    if (this.settled) {
      return;
    }
    this.aborted = true;
    this.error = error ?? new DOMException("Transaction aborted", "AbortError");
    this.onerror?.();
    this.check();
  }

  private check(): void {
    if (this.settled || this.pending > 0) {
      return;
    }
    this.settled = true;
    if (this.aborted) {
      queueMicrotask(() => this.onabort?.());
      return;
    }
    for (const [name, data] of this.snapshots) {
      this.backend.stores.set(name, data);
    }
    queueMicrotask(() => this.oncomplete?.());
  }
}

/** Backing storage shared by every connection to the same database. */
class FakeBackend {
  readonly stores = new Map<string, StoreData>();
}

/** One `indexedDB.open()` result — a distinct connection per call. */
class FakeDatabase {
  private readonly backend: FakeBackend;
  onclose: (() => void) | null = null;
  onversionchange: (() => void) | null = null;
  readonly objectStoreNames: { contains(name: string): boolean };

  constructor(backend: FakeBackend) {
    this.backend = backend;
    this.objectStoreNames = {
      contains: (name: string): boolean => this.backend.stores.has(name),
    };
  }

  createObjectStore(name: string): void {
    if (!this.backend.stores.has(name)) {
      this.backend.stores.set(name, new Map());
    }
  }

  transaction(
    storeNames: string[] | string,
    mode = "readonly",
  ): FakeTransaction {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const transaction = new FakeTransaction(this.backend, names, mode);
    if (idbHarness.abortNextTransaction) {
      idbHarness.abortNextTransaction = false;
      transaction.abort(new DOMException("Injected abort", "AbortError"));
    }
    return transaction;
  }

  close(): void {
    this.onclose?.();
  }
}

const idbHarness = {
  abortNextTransaction: false,
  databases: new Map<string, FakeBackend>(),
  open(name: string): FakeIDBRequest {
    const request = new FakeIDBRequest();
    queueMicrotask(() => {
      try {
        let backend = this.databases.get(name);
        if (backend) {
          request.result = new FakeDatabase(backend);
        } else {
          backend = new FakeBackend();
          this.databases.set(name, backend);
          request.result = new FakeDatabase(backend);
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      } catch (error) {
        request.error =
          error instanceof DOMException
            ? error
            : new DOMException("Open failed", "UnknownError");
        request.onerror?.();
      }
    });
    return request;
  },
};

class FakeFileHandle {
  readonly kind = "file";
  content: Blob | null = null;

  getFile(): Promise<Blob> {
    if (!this.content) {
      return Promise.reject(
        new DOMException("File not found", "NotFoundError"),
      );
    }
    return Promise.resolve(this.content);
  }

  createWritable(): Promise<{
    write(data: string | Blob): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }> {
    const chunks: (string | Blob)[] = [];
    return Promise.resolve({
      abort: () => Promise.resolve(),
      close: () => {
        this.content =
          chunks.length === 1 && chunks[0] instanceof Blob
            ? chunks[0]
            : new Blob(chunks as BlobPart[]);
        return Promise.resolve();
      },
      write: (data: string | Blob) => {
        chunks.push(data);
        return Promise.resolve();
      },
    });
  }
}

class FakeDirectoryHandle {
  readonly kind = "directory";
  readonly children = new Map<string, FakeDirectoryHandle | FakeFileHandle>();

  getDirectoryHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<FakeDirectoryHandle> {
    const existing = this.children.get(name);
    if (existing instanceof FakeDirectoryHandle) {
      return Promise.resolve(existing);
    }
    if (existing || !options.create) {
      return Promise.reject(
        new DOMException("Directory not found", "NotFoundError"),
      );
    }
    const created = new FakeDirectoryHandle();
    this.children.set(name, created);
    return Promise.resolve(created);
  }

  getFileHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<FakeFileHandle> {
    const existing = this.children.get(name);
    if (existing instanceof FakeFileHandle) {
      return Promise.resolve(existing);
    }
    if (existing || !options.create) {
      return Promise.reject(
        new DOMException("File not found", "NotFoundError"),
      );
    }
    const created = new FakeFileHandle();
    this.children.set(name, created);
    return Promise.resolve(created);
  }

  removeEntry(
    name: string,
    _options: { recursive?: boolean } = {},
  ): Promise<void> {
    if (!this.children.delete(name)) {
      return Promise.reject(
        new DOMException("Entry not found", "NotFoundError"),
      );
    }
    return Promise.resolve();
  }

  // biome-ignore lint/suspicious/useAwait: mocks FileSystemDirectoryHandle.entries, which is an async iterator
  async *entries(): AsyncIterableIterator<
    [string, FakeDirectoryHandle | FakeFileHandle]
  > {
    for (const entry of this.children) {
      yield entry;
    }
  }
}

const opfsRoot = new FakeDirectoryHandle();

Object.defineProperty(globalThis, "indexedDB", {
  configurable: true,
  value: { open: (name: string) => idbHarness.open(name) },
});
Object.defineProperty(globalThis, "IDBKeyRange", {
  configurable: true,
  value: {
    bound: (lower: string, upper: string): KeyRange => ({ lower, upper }),
  },
});
Object.defineProperty(navigator, "storage", {
  configurable: true,
  value: { getDirectory: () => Promise.resolve(opfsRoot) },
});

const {
  captureOfflineCacheScope,
  isOfflineCacheUserSuspended,
  openOfflineCache,
} = await import("./offline-cache.ts");
const { readCachedDrive } = await import("./cached-drive-reader.ts");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encodePathPart(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/[=]+$/, "");
}

function metadataStore(): StoreData {
  const database = idbHarness.databases.get("miyulabmd-offline-cache");
  assert.ok(database, "offline cache database must exist");
  const store = database.stores.get("metadata");
  assert.ok(store, "metadata store must exist");
  return store;
}

function metadataValue(key: string): string | undefined {
  return (metadataStore().get(key) as { value?: string } | undefined)?.value;
}

function writeMetadata(key: string, value: string): void {
  metadataStore().set(key, { key, value });
}

function userLockName(userId: string): string {
  return `miyulabmd-offline-cache:user:${encodePathPart(userId)}`;
}

function userEpochKey(userId: string): string {
  return `user-epoch:${encodePathPart(userId)}`;
}

function note(id: string, ownerId: string): Note {
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
    editLocked: false,
    folder: "",
    folderId: null,
    id,
    markdown: `# ${id}`,
    ownerId,
    permission: "private",
    shortId: `s-${id}`,
    title: id,
    updatedAt: 2,
  };
}

function folder(id: string | null): FolderAccess {
  return {
    children: [],
    crumbs: [],
    effectiveReadScope: "self",
    effectiveWriteScope: "self",
    flags: { canAdmin: true, canEdit: true, canView: true },
    grants: [],
    id,
    inherit: true,
    name: id ?? "root",
    parentId: null,
    readScope: null,
    source: "default",
    sourceFolder: null,
    writeScope: null,
  };
}

function summary(id: string, ownerId: string): NoteSummary {
  const { markdown: _markdown, ...rest } = note(id, ownerId);
  return rest;
}

function opfsUserDirectory(userId: string): FakeDirectoryHandle | undefined {
  const app = opfsRoot.children.get("miyulabmd-offline-cache-v1");
  if (!(app instanceof FakeDirectoryHandle)) {
    return undefined;
  }
  const user = app.children.get(encodePathPart(userId));
  return user instanceof FakeDirectoryHandle ? user : undefined;
}

function resetStores(): void {
  for (const database of idbHarness.databases.values()) {
    for (const store of database.stores.values()) {
      store.clear();
    }
  }
  opfsRoot.children.clear();
  idbHarness.abortNextTransaction = false;
}

afterEach(resetStores);

// ---------------------------------------------------------------------------
// Phase 1: purge tombstone self-healing
// ---------------------------------------------------------------------------

test("openOfflineCache completes an interrupted user purge instead of failing", async () => {
  const userId = "user-heal-1";
  const seeded = await openOfflineCache({ userId });
  await seeded.putNote(note("note-a", userId));
  await seeded.putNoteList([summary("note-a", userId)]);
  await seeded.putFolder(folder(null), { asDriveRoot: true });
  seeded.close();
  assert.ok(opfsUserDirectory(userId), "seeded OPFS data must exist");

  // Simulate a purge that died after writing its tombstone marker.
  writeMetadata(userEpochKey(userId), `${crypto.randomUUID()}:purging`);

  const cache = await openOfflineCache({ userId });
  assert.equal(cache.degraded, false);
  try {
    // The healed purge finished deleting the scoped data.
    assert.equal(await cache.getNoteList(), null);
    assert.equal(await cache.getFolder(null), null);
  } finally {
    cache.close();
  }
  const epoch = metadataValue(userEpochKey(userId));
  assert.ok(epoch);
  assert.ok(!epoch.endsWith(":purging"));
  assert.equal(opfsUserDirectory(userId), undefined);
});

test("openOfflineCache completes an interrupted device purge", async () => {
  const userId = "user-heal-2";
  const seeded = await openOfflineCache({ userId });
  await seeded.putNoteList([summary("note-b", userId)]);
  seeded.close();

  writeMetadata("device-clear-state", "purging");

  const cache = await openOfflineCache({ userId });
  assert.equal(cache.degraded, false);
  try {
    assert.equal(await cache.getNoteList(), null);
  } finally {
    cache.close();
  }
  assert.equal(metadataValue("device-clear-state"), "active");
  const epoch = metadataValue("device-epoch");
  assert.ok(epoch);
  assert.ok(!epoch.endsWith(":purging"));
});

test("openOfflineCache returns a degraded empty cache while a live purge holds the lock", async () => {
  const userId = "user-heal-3";
  const seeded = await openOfflineCache({ userId });
  await seeded.putNoteList([summary("note-c", userId)]);
  seeded.close();
  writeMetadata(userEpochKey(userId), `${crypto.randomUUID()}:purging`);

  // A live purge in another tab holds the exclusive user lock.
  const release = Promise.withResolvers<void>();
  const held = navigator.locks.request(
    userLockName(userId),
    { mode: "exclusive" },
    () => release.promise,
  );

  const cache = await openOfflineCache({ userId });
  assert.equal(cache.degraded, true);
  // Reads degrade to misses; writes surface a warning-level failure to
  // callers instead of blocking or suspending the display.
  assert.equal(await cache.getNoteList(), null);
  assert.equal(await cache.getNote("note-c"), null);
  assert.equal(await cache.getFolderState(null), "missing");
  assert.equal(await cache.getNoteListState(), "missing");
  await assert.rejects(cache.putNoteList([summary("late", userId)]));
  await assert.rejects(cache.putNote(note("late", userId)));
  await assert.rejects(cache.denyFolder(null));
  await assert.rejects(cache.denyNote("note-c"));
  cache.close();

  release.resolve();
  await held;

  // Once the live purge lets go, the next open heals the marker.
  const healed = await openOfflineCache({ userId });
  assert.equal(healed.degraded, false);
  healed.close();
  assert.ok(!metadataValue(userEpochKey(userId))?.endsWith(":purging"));
});

test("captureOfflineCacheScope heals a tombstone and reports usable authority", async () => {
  const userId = "user-heal-4";
  const seeded = await openOfflineCache({ userId });
  seeded.close();
  writeMetadata(userEpochKey(userId), `${crypto.randomUUID()}:purging`);

  const scope = await captureOfflineCacheScope(userId);
  assert.equal(scope.userId, userId);
  assert.ok(scope.epoch !== null, "healed scope must carry an epoch");
});

test("captureOfflineCacheScope yields no authority while a live purge runs", async () => {
  const userId = "user-heal-5";
  const seeded = await openOfflineCache({ userId });
  seeded.close();
  writeMetadata(userEpochKey(userId), `${crypto.randomUUID()}:purging`);

  const release = Promise.withResolvers<void>();
  const held = navigator.locks.request(
    userLockName(userId),
    { mode: "exclusive" },
    () => release.promise,
  );
  try {
    const scope = await Promise.race([
      captureOfflineCacheScope(userId),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("scope capture blocked")), 5000),
      ),
    ]);
    assert.equal(scope.epoch, null);
  } finally {
    release.resolve();
    await held;
  }
});

// ---------------------------------------------------------------------------
// Phase 0: display reads degrade to cache miss, never to AbortError
// ---------------------------------------------------------------------------

test("readCachedDrive treats an interrupted purge as an empty cache", async () => {
  const userId = "user-failsoft-1";
  const seeded = await openOfflineCache({ userId });
  await seeded.putNoteList([summary("note-d", userId)]);
  await seeded.putFolder(folder(null), { asDriveRoot: true });
  seeded.close();
  writeMetadata(userEpochKey(userId), `${crypto.randomUUID()}:purging`);

  const view = await readCachedDrive(userId, null);
  assert.equal(view.folderMissing, true);
  assert.equal(view.notesMissing, true);
  assert.deepEqual(view.notes, []);
});

test("readCachedDrive returns cached data on a healthy cache", async () => {
  const userId = "user-failsoft-2";
  const seeded = await openOfflineCache({ userId });
  await seeded.putFolder(folder("folder-1"));
  await seeded.putNoteList([summary("note-e", userId)]);
  seeded.close();

  const view = await readCachedDrive(userId, "folder-1");
  assert.equal(view.folderMissing, false);
  assert.equal(view.folder?.id, "folder-1");
  assert.equal(view.notesMissing, false);
  assert.deepEqual(
    view.notes.map((item) => item.id),
    ["note-e"],
  );
});

test("a failed denial write does not suspend the user's cached reads", async () => {
  const userId = "user-failsoft-3";
  const seeded = await openOfflineCache({ userId });
  await seeded.putNote(note("note-f", userId));
  await seeded.putNoteList([summary("note-f", userId)]);
  seeded.close();

  const cache = await openOfflineCache({ userId });
  try {
    idbHarness.abortNextTransaction = true;
    await assert.rejects(cache.denyNote("note-f"));
    // The failed denial is a warning, not a user-wide suspension.
    assert.equal(isOfflineCacheUserSuspended(userId), false);
    // Cached data still reads back instead of being hidden.
    const cached = await cache.getNote("note-f");
    assert.equal(cached?.note.id, "note-f");
  } finally {
    cache.close();
  }
});

test("openOfflineCache still honours a caller's own abort", async () => {
  const controller = new AbortController();
  controller.abort(new Error("navigated away"));
  await assert.rejects(
    openOfflineCache({ signal: controller.signal, userId: "user-failsoft-4" }),
    /navigated away/,
  );
});

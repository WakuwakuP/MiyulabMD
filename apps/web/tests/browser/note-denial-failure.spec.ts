import { expect, test } from "@playwright/test";
import { note } from "./fixtures/note.ts";

test("a durable denial hides cached content after reload even when physical cleanup fails", async ({
  page,
}) => {
  await page.route(`**/api/notes/${note.id}`, (route) =>
    route.fulfill({ json: { error: "Forbidden" }, status: 403 }),
  );
  await page.goto("/tests/browser/fixtures/storage.html");
  const denial = await page.evaluate(async (note) => {
    const cacheUrl = "/src/lib/offline-cache.ts";
    const readerUrl = "/src/lib/note-read-session.ts";
    const { openOfflineCache } = await import(cacheUrl);
    const { createNoteReadSession } = await import(readerUrl);
    const alice = await openOfflineCache({ userId: "alice" });
    const bob = await openOfflineCache({ userId: "bob" });
    const { markdown: _markdown, ...summary } = note;
    try {
      await alice.putNote(note);
      await alice.putNote({ ...note, id: "keep-me", shortId: "keep-short" });
      await alice.putNoteList([
        summary,
        { ...summary, id: "keep-me", shortId: "keep-short" },
      ]);
      await bob.putNote(note);
    } finally {
      alice.close();
      bob.close();
    }
    const reader = createNoteReadSession({
      cacheViewerId: "alice",
      mode: "authenticated",
      user: { displayName: "Alice", email: "alice@example.test", id: "alice" },
    });
    const originalDelete = IDBObjectStore.prototype.delete;
    let deleteAttempts = 0;
    IDBObjectStore.prototype.delete = () => {
      deleteAttempts += 1;
      throw new DOMException("Physical cleanup failed", "UnknownError");
    };
    try {
      const result = await reader.read(note.id);
      return { deleteAttempts, result };
    } finally {
      IDBObjectStore.prototype.delete = originalDelete;
      reader.dispose();
    }
  }, note);
  expect(denial.result).toMatchObject({ ok: false, status: 403 });
  expect(denial.deleteAttempts).toBeGreaterThan(0);

  await page.reload();
  const cached = await page.evaluate(async (id) => {
    const moduleUrl = "/src/lib/offline-cache.ts";
    const { openOfflineCache } = await import(moduleUrl);
    const alice = await openOfflineCache({ userId: "alice" });
    const bob = await openOfflineCache({ userId: "bob" });
    try {
      return {
        denied: await alice.getNote(id),
        list: (await alice.getNoteList())?.notes.map(
          (item: { id: string }) => item.id,
        ),
        otherViewer: (await bob.getNote(id))?.note.id,
        unrelated: (await alice.getNote("keep-me"))?.note.id,
      };
    } finally {
      alice.close();
      bob.close();
    }
  }, note.id);
  expect(cached).toEqual({
    denied: null,
    list: ["keep-me"],
    otherViewer: note.id,
    unrelated: "keep-me",
  });

  await page.unroute(`**/api/notes/${note.id}`);
  await page.route(`**/api/notes/${note.id}`, (route) =>
    route.abort("internetdisconnected"),
  );
  const later = await page.evaluate(async (id) => {
    const moduleUrl = "/src/lib/note-read-session.ts";
    const { createNoteReadSession } = await import(moduleUrl);
    const reader = createNoteReadSession({
      cacheViewerId: "alice",
      mode: "authenticated",
      user: { displayName: "Alice", email: "alice@example.test", id: "alice" },
    });
    try {
      const result = await reader.read(id);
      return result.ok;
    } catch {
      return false;
    } finally {
      reader.dispose();
    }
  }, note.id);
  expect(later).toBe(false);
});

test("failure to persist a denial suspends that user's live cache and reports a warning", async ({
  page,
}) => {
  await page.route(`**/api/notes/${note.id}`, (route) =>
    route.fulfill({ json: { error: "Forbidden" }, status: 403 }),
  );
  await page.goto("/tests/browser/fixtures/storage.html");
  const result = await page.evaluate(async (note) => {
    const cacheUrl = "/src/lib/offline-cache.ts";
    const readerUrl = "/src/lib/note-read-session.ts";
    const { openOfflineCache } = await import(cacheUrl);
    const { createNoteReadSession } = await import(readerUrl);
    const alice = await openOfflineCache({ userId: "alice" });
    const bob = await openOfflineCache({ userId: "bob" });
    await alice.putNote(note);
    await alice.putNote({ ...note, id: "keep-me", shortId: "keep-short" });
    await bob.putNote(note);
    alice.close();
    bob.close();
    const reader = createNoteReadSession({
      cacheViewerId: "alice",
      mode: "authenticated",
      user: { displayName: "Alice", email: "alice@example.test", id: "alice" },
    });
    const original = IDBDatabase.prototype.transaction;
    let interrupted = false;
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase["transaction"]>
    ) {
      const transaction = original.apply(this, args);
      if (args[1] === "readwrite") {
        interrupted = true;
        transaction.abort();
      }
      return transaction;
    };
    let denial: {
      ok: boolean;
      status?: number;
      cacheWarning?: string;
    } | null = null;
    try {
      denial = await reader.read(note.id);
    } finally {
      IDBDatabase.prototype.transaction = original;
      reader.dispose();
    }
    // Fresh handles must still honor the live suspension after the I/O fault
    // has gone away. This test does not claim durability when all writes fail.
    const freshAlice = await openOfflineCache({ userId: "alice" });
    const freshBob = await openOfflineCache({ userId: "bob" });
    try {
      return {
        denial,
        denied: await freshAlice.getNote(note.id),
        interrupted,
        otherViewer: (await freshBob.getNote(note.id))?.note.id,
        unrelated: await freshAlice.getNote("keep-me"),
      };
    } finally {
      freshAlice.close();
      freshBob.close();
    }
  }, note);
  expect(result.interrupted).toBe(true);
  expect(result.denial).toMatchObject({ ok: false, status: 403 });
  expect(result.denial?.cacheWarning).toEqual(expect.any(String));
  expect(result.denial?.cacheWarning).toContain("キャッシュ");
  expect(result.denied).toBeNull();
  expect(result.unrelated).toBeNull();
  expect(result.otherViewer).toBe(note.id);
});

test("a denial still suspends the user's cache when the database cannot be opened", async ({
  page,
}) => {
  await page.route(`**/api/notes/${note.id}`, (route) =>
    route.fulfill({ json: { error: "Forbidden" }, status: 403 }),
  );
  await page.goto("/tests/browser/fixtures/storage.html");
  const result = await page.evaluate(async (note) => {
    const cacheUrl = "/src/lib/offline-cache.ts";
    const readerUrl = "/src/lib/note-read-session.ts";
    const { openOfflineCache } = await import(cacheUrl);
    const { createNoteReadSession } = await import(readerUrl);
    const alice = await openOfflineCache({ userId: "alice" });
    const bob = await openOfflineCache({ userId: "bob" });
    const { markdown: _markdown, ...summary } = note;
    await alice.putNote(note);
    await alice.putNote({ ...note, id: "keep-me", shortId: "keep-short" });
    await alice.putNoteList([summary]);
    await bob.putNote(note);
    const reader = createNoteReadSession({
      cacheViewerId: "alice",
      mode: "authenticated",
      user: { displayName: "Alice", email: "alice@example.test", id: "alice" },
    });
    const originalOpen = IDBFactory.prototype.open;
    let openAttempts = 0;
    IDBFactory.prototype.open = () => {
      openAttempts += 1;
      throw new DOMException("Database temporarily unavailable", "UnknownError");
    };
    let denial: {
      ok: boolean;
      status?: number;
      cacheWarning?: string;
    } | null = null;
    try {
      denial = await reader.read(note.id);
    } finally {
      IDBFactory.prototype.open = originalOpen;
      reader.dispose();
    }
    // A successful subsequent open must not silently restore cache access.
    // Both existing and fresh handles share the affected user's suspension.
    const freshAlice = await openOfflineCache({ userId: "alice" });
    try {
      return {
        denial,
        existingHandle: await alice.getNote(note.id),
        freshHandle: await freshAlice.getNote(note.id),
        list: await freshAlice.getNoteList(),
        openAttempts,
        otherViewer: (await bob.getNote(note.id))?.note.id,
        unrelated: await freshAlice.getNote("keep-me"),
      };
    } finally {
      alice.close();
      bob.close();
      freshAlice.close();
    }
  }, note);
  expect(result.openAttempts).toBeGreaterThan(0);
  expect(result.denial).toMatchObject({ ok: false, status: 403 });
  expect(result.denial?.cacheWarning).toContain("キャッシュ");
  expect(result.existingHandle).toBeNull();
  expect(result.freshHandle).toBeNull();
  expect(result.list).toBeNull();
  expect(result.unrelated).toBeNull();
  expect(result.otherViewer).toBe(note.id);

  await page.unroute(`**/api/notes/${note.id}`);
  await page.route(`**/api/notes/${note.id}`, (route) =>
    route.abort("internetdisconnected"),
  );
  const later = await page.evaluate(async (id) => {
    const moduleUrl = "/src/lib/note-read-session.ts";
    const { createNoteReadSession } = await import(moduleUrl);
    const reader = createNoteReadSession({
      cacheViewerId: "alice",
      mode: "authenticated",
      user: { displayName: "Alice", email: "alice@example.test", id: "alice" },
    });
    try {
      return (await reader.read(id)).ok;
    } catch {
      return false;
    } finally {
      reader.dispose();
    }
  }, note.id);
  expect(later).toBe(false);
});

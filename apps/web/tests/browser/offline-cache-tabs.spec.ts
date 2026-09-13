import { expect, test } from "@playwright/test";
import { note } from "./fixtures/note.ts";

test("clearing a user in another tab prevents a late note response from restoring data", async ({
  page,
  context,
}) => {
  await page.goto("/tests/browser/fixtures/storage.html");
  const other = await context.newPage();
  await other.goto("/tests/browser/fixtures/storage.html");
  try {
    await other.evaluate(async (note) => {
      const moduleUrl = "/src/lib/note-read-session.ts";
      const { createNoteReadSession } = await import(moduleUrl);
      const entered = Promise.withResolvers<void>();
      const response = Promise.withResolvers<Response>();
      const original = globalThis.fetch;
      globalThis.fetch = () => {
        entered.resolve();
        return response.promise;
      };
      const session = createNoteReadSession({
        cacheViewerId: "alice",
        mode: "authenticated",
        user: {
          displayName: "Alice",
          email: "alice@example.test",
          id: "alice",
        },
      });
      const pendingNote = session
        .read(note.id)
        .then(
          (result: { ok: boolean }) => result.ok,
          () => false,
        )
        .finally(() => {
          session.dispose();
          globalThis.fetch = original;
        });
      Object.assign(window, {
        pendingNote,
        releasePendingNote: () =>
          response.resolve(new Response(JSON.stringify(note))),
      });
      await entered.promise;
    }, note);
    await page.evaluate(async () => {
      const moduleUrl = "/src/lib/offline-cache.ts";
      const { clearOfflineCacheUser } = await import(moduleUrl);
      await clearOfflineCacheUser("alice");
    });
    const published = await other.evaluate(async () => {
      const fixture = window as typeof window & {
        pendingNote: Promise<boolean>;
        releasePendingNote(): void;
      };
      fixture.releasePendingNote();
      return await fixture.pendingNote;
    });
    const restored = await page.evaluate(async (id) => {
      const moduleUrl = "/src/lib/offline-cache.ts";
      const { openOfflineCache } = await import(moduleUrl);
      const cache = await openOfflineCache({ userId: "alice" });
      try {
        return await cache.getNote(id);
      } finally {
        cache.close();
      }
    }, note.id);
    expect(published).toBe(false);
    expect(restored).toBeNull();
  } finally {
    await other.close();
  }
});

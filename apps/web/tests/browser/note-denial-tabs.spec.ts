import { expect, test } from "@playwright/test";
import { note } from "./fixtures/note.ts";

test("another tab's note denial fences an old response and allows fresh revalidation", async ({
  page,
  context,
}) => {
  await page.goto("/tests/browser/fixtures/storage.html");
  const peer = await context.newPage();
  await peer.goto("/tests/browser/fixtures/storage.html");
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const headers = { "X-MiyulabMD-Session-User": "user:alice" };
  await page.route(`**/api/notes/${note.id}`, async (route) => {
    started.resolve();
    await release.promise;
    await route.fulfill({ headers, json: note });
  });
  let denied = true;
  await peer.route(`**/api/notes/${note.id}`, (route) =>
    route.fulfill({
      headers,
      json: denied
        ? { error: "Forbidden" }
        : { ...note, markdown: "Fresh authorized body", updatedAt: 99 },
      status: denied ? 403 : 200,
    }),
  );
  const read = async (id: string) => {
    const url = "/src/lib/note-read-session.ts";
    const { createNoteReadSession } = await import(url);
    const session = createNoteReadSession({
      cacheViewerId: "alice",
      mode: "authenticated",
      user: { displayName: "Alice", email: "alice@example.test", id: "alice" },
    });
    try {
      return await session.read(id).then(
        (result: { ok: boolean; status?: number }) => ({
          ok: result.ok,
          status: result.status,
        }),
        () => ({ ok: false }),
      );
    } finally {
      session.dispose();
    }
  };
  const cachedBody = async (id: string) => {
    const url = "/src/lib/offline-cache.ts";
    const { openOfflineCache } = await import(url);
    const cache = await openOfflineCache({ userId: "alice" });
    try {
      return (await cache.getNote(id))?.note.markdown ?? null;
    } finally {
      cache.close();
    }
  };
  try {
    const pending = page.evaluate(read, note.id);
    await started.promise;
    expect(await peer.evaluate(read, note.id)).toEqual({
      ok: false,
      status: 403,
    });
    expect(await peer.evaluate(cachedBody, note.id)).toBeNull();
    release.resolve();
    const stale = await pending;
    const restored = await peer.evaluate(cachedBody, note.id);
    expect({ restored, stale: stale.ok }).toEqual({
      restored: null,
      stale: false,
    });
    denied = false;
    expect((await peer.evaluate(read, note.id)).ok).toBe(true);
    expect(await peer.evaluate(cachedBody, note.id)).toBe(
      "Fresh authorized body",
    );
  } finally {
    release.resolve();
    await peer.close();
  }
});

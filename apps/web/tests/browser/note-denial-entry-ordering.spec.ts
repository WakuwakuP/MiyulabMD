import { expect, test } from "@playwright/test";
import { note } from "./fixtures/note.ts";

test("denial invalidates an older network request even when its database cannot open", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/storage.html");
  const result = await page.evaluate(async (note) => {
    const moduleUrl = "/src/lib/note-read-session.ts";
    const { createNoteReadSession } = await import(moduleUrl);
    const viewer = {
      cacheViewerId: "alice",
      mode: "authenticated",
      user: {
        displayName: "Alice",
        email: "alice@example.test",
        id: "alice",
      },
    };
    const slowReader = createNoteReadSession(viewer);
    const denyingReader = createNoteReadSession(viewer);
    const newReader = createNoteReadSession(viewer);
    const originalFetch = globalThis.fetch;
    const originalOpen = IDBFactory.prototype.open;
    let release: (response: Response) => void = () => {
      throw new Error("Slow request has not started");
    };
    let started: () => void = () => {
      // Assigned synchronously by the promise constructor.
    };
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let requests = 0;
    globalThis.fetch = () => {
      if (++requests === 1) {
        return new Promise<Response>((resolve) => {
          release = resolve;
          started();
        });
      }
      return Promise.resolve(
        requests === 2
          ? new Response(JSON.stringify({ error: "Forbidden" }), {
              status: 403,
            })
          : new Response(JSON.stringify(note), { status: 200 }),
      );
    };
    try {
      const oldRequest = slowReader.read(note.id).then(
        (value: { ok: boolean }) => value.ok,
        () => false,
      );
      await firstStarted;
      IDBFactory.prototype.open = () => {
        throw new DOMException("Database unavailable", "UnknownError");
      };
      const denial = await denyingReader.read(note.id);
      IDBFactory.prototype.open = originalOpen;
      release(new Response(JSON.stringify(note), { status: 200 }));
      const oldPublished = await oldRequest;
      // Cache suspension must not prohibit a genuinely new online response.
      const fresh = await newReader.read(note.id);
      return { denial, fresh, oldPublished };
    } finally {
      IDBFactory.prototype.open = originalOpen;
      globalThis.fetch = originalFetch;
      slowReader.dispose();
      denyingReader.dispose();
      newReader.dispose();
    }
  }, note);
  expect(result.denial).toMatchObject({ ok: false, status: 403 });
  expect(result.denial.cacheWarning).toContain("キャッシュ");
  expect(result.oldPublished).toBe(false);
  expect(result.fresh).toMatchObject({ ok: true, source: "network" });
});

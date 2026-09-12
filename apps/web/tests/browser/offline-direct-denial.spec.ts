import { expect, test } from "@playwright/test";
import { note } from "./fixtures/note.ts";

test("direct cache denial prevents an already-reading body from being returned", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/storage.html");
  const result = await page.evaluate(async (note) => {
    const moduleUrl = "/src/lib/offline-cache.ts";
    const { openOfflineCache } = await import(moduleUrl);
    const cache = await openOfflineCache({ userId: "alice" });
    await cache.putNote(note);
    const originalText = Blob.prototype.text;
    let reading: () => void = () => {
      // Assigned synchronously below.
    };
    let release: () => void = () => {
      // Assigned synchronously below.
    };
    const started = new Promise<void>((resolve) => {
      reading = resolve;
    });
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    Blob.prototype.text = async function (this: Blob) {
      const text = await originalText.call(this);
      reading();
      await released;
      return text;
    };
    try {
      const pending = cache.getNote(note.id);
      await started;
      await cache.denyNote(note.id);
      release();
      return await pending;
    } finally {
      release();
      Blob.prototype.text = originalText;
      cache.close();
    }
  }, note);
  expect(result).toBeNull();
});

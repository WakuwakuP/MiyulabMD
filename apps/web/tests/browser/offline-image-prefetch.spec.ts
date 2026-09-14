import { expect, test } from "@playwright/test";
import { note } from "./fixtures/note.ts";

const headers = { "X-MiyulabMD-Session-User": "user:alice" };

test("prefetch acquires images only after all bodies and uses the referenced parent once", async ({
  page,
}) => {
  const imagePath = "/api/notes/another-parent/images/shared-image";
  const markdown = [
    note.markdown,
    `![Attached](${imagePath})`,
    "![External](https://external.test/image.png)",
  ].join("\n\n");
  const notes = ["first", "second"].map((id) => ({
    ...note,
    folderId: "root",
    id,
    markdown,
    ownerId: "alice",
    shortId: `${id}-short`,
  }));
  const folder = {
    ...note.access,
    children: [],
    crumbs: [{ id: "root", name: "MyDrive" }],
    folder: "",
    id: "root",
    locked: true,
    name: "MyDrive",
    parentId: null,
  };
  const requests: string[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    requests.push(path);
    if (path === "/api/folders/tree") {
      return route.fulfill({ headers, json: { folders: [folder] } });
    }
    if (path === "/api/folders/root") {
      return route.fulfill({ headers, json: folder });
    }
    if (path === "/api/notes") {
      return route.fulfill({ headers, json: { notes } });
    }
    const body = notes.find((item) => path === `/api/notes/${item.id}`);
    if (body) {
      return route.fulfill({ headers, json: body });
    }
    if (path === imagePath) {
      return route.fulfill({
        body: "image bytes",
        contentType: "image/png",
        headers,
      });
    }
    return route.fulfill({ headers, json: { error: "No fixture" }, status: 404 });
  });
  await page.goto("/tests/browser/fixtures/storage.html");
  const result = await page.evaluate(async () => {
    const prefetchUrl = "/src/lib/mydrive-prefetch.ts";
    const cacheUrl = "/src/lib/offline-cache.ts";
    const { prefetchMyDrive } = await import(prefetchUrl);
    const { openOfflineCache } = await import(cacheUrl);
    const outcome = await prefetchMyDrive({
      cacheViewerId: "alice",
      mode: "authenticated",
      user: {
        displayName: "Alice",
        email: "alice@example.test",
        id: "alice",
      },
    });
    const cache = await openOfflineCache({ userId: "alice" });
    try {
      return {
        body: (await cache.getNote("second")).note.markdown,
        image: await (
          await cache.getImage("another-parent", "shared-image")
        ).text(),
        outcome,
      };
    } finally {
      cache.close();
    }
  });
  expect(result).toEqual({
    body: markdown,
    image: "image bytes",
    outcome: { folders: 1, notes: 2, status: "success" },
  });
  expect(requests.filter((path) => path === imagePath)).toHaveLength(1);
  expect(requests.indexOf(imagePath)).toBeGreaterThan(
    requests.indexOf("/api/notes/second"),
  );
});

test("an image response arriving after purge cannot repopulate or publish bytes", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/storage.html");
  const result = await page.evaluate(async () => {
    const imageUrl = "/src/lib/attached-images.ts";
    const cacheUrl = "/src/lib/offline-cache.ts";
    const { acquireAttachedImage, attachedImage } = await import(imageUrl);
    const {
      captureOfflineCacheScope,
      clearOfflineCacheUser,
      openOfflineCache,
    } = await import(cacheUrl);
    const scope = await captureOfflineCacheScope("alice");
    const originalFetch = globalThis.fetch;
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const requested = new Promise<void>((resolve) => {
      started = resolve;
    });
    globalThis.fetch = async () => {
      started();
      await gate;
      return new Response(new Blob(["late"], { type: "image/png" }), {
        headers: { "X-MiyulabMD-Session-User": "user:alice" },
      });
    };
    try {
      const pending = acquireAttachedImage(
        attachedImage("/api/notes/parent/images/image"),
        { cacheOnly: false, scope },
      ).then(
        () => false,
        () => true,
      );
      await requested;
      await clearOfflineCacheUser("alice");
      release();
      const rejected = await pending;
      const fresh = await openOfflineCache({ userId: "alice" });
      try {
        return { image: await fresh.getImage("parent", "image"), rejected };
      } finally {
        fresh.close();
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
  expect(result).toEqual({ image: null, rejected: true });
});

test("unsupported image MIME cannot replace a supported cached image", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/storage.html");
  const result = await page.evaluate(async () => {
    const cacheUrl = "/src/lib/offline-cache.ts";
    const { openOfflineCache, suspendOfflineCacheUser } = await import(
      cacheUrl
    );
    const cache = await openOfflineCache({ userId: "alice" });
    try {
      await cache.putImage(
        "parent",
        "image",
        new Blob(["prior"], { type: "image/png" }),
      );
      const rejected = await cache
        .putImage(
          "parent",
          "image",
          new Blob(["<svg/>"], { type: "image/svg+xml" }),
        )
        .then(
          () => false,
          () => true,
        );
      const prior = await (await cache.getImage("parent", "image")).text();
      suspendOfflineCacheUser("alice");
      return {
        prior,
        rejected,
        suspended: await cache.getImage("parent", "image"),
      };
    } finally {
      cache.close();
    }
  });
  expect(result).toEqual({ prior: "prior", rejected: true, suspended: null });
});

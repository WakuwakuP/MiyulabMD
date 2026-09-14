import { expect, test } from "@playwright/test";
import { note } from "./fixtures/note.ts";

for (const failure of ["abort", "metadata", "abort-and-metadata"] as const) {
  test(`cache opening cleans up after ${failure} during epoch acquisition`, async ({
    page,
  }) => {
    await page.goto("/tests/browser/fixtures/storage.html");
    const result = await page.evaluate(async (failure) => {
      const moduleUrl = "/src/lib/offline-cache.ts";
      const { openOfflineCache } = await import(moduleUrl);
      const originalGet = IDBObjectStore.prototype.get;
      const originalClose = IDBDatabase.prototype.close;
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const reason = new Error("Distinct epoch cancellation");
      const metadataError = new Error("Epoch metadata unavailable");
      const controller = new AbortController();
      let closes = 0;
      let gated = false;
      let opened: { close(): void } | undefined;
      IDBDatabase.prototype.close = function () {
        closes++;
        return originalClose.call(this);
      };
      IDBObjectStore.prototype.get = function (key) {
        if (!gated && String(key).startsWith("user-epoch:")) {
          gated = true;
          if (failure !== "abort") {
            if (failure === "abort-and-metadata") {
              controller.abort(reason);
            }
            throw metadataError;
          }
          const request = originalGet.call(this, key);
          Object.defineProperty(request, "onsuccess", {
            set(handler: (event: Event) => void) {
              request.addEventListener("success", (event) => {
                entered.resolve();
                void release.promise.then(() => handler.call(request, event));
              });
            },
          });
          return request;
        }
        return originalGet.call(this, key);
      };
      try {
        const pending = openOfflineCache({
          signal: controller.signal,
          userId: "alice",
        }).then(
          (cache: { close(): void }) => {
            opened = cache;
            return false;
          },
          (error: unknown) =>
            error === (failure === "metadata" ? metadataError : reason),
        );
        if (failure === "abort") {
          await entered.promise;
          controller.abort(reason);
          release.resolve();
        }
        const rejected = await pending;
        return { closedBeforeReturn: closes, rejected };
      } finally {
        release.resolve();
        opened?.close();
        IDBObjectStore.prototype.get = originalGet;
        IDBDatabase.prototype.close = originalClose;
      }
    }, failure);
    expect(result.rejected).toBe(true);
    expect(result.closedBeforeReturn).toBe(1);
  });
}

for (const scenario of [
  "home-abort",
  "home-abort-failure",
  "home-owner",
  "note-dispose",
  "note-denial",
] as const) {
  test(`final epoch verification cannot publish after ${scenario}`, async ({
    page,
  }) => {
    await page.goto("/tests/browser/fixtures/storage.html");
    type Input = { note: typeof note; scenario: typeof scenario };
    const exercise = async ({ scenario, note }: Input) => {
      const cacheUrl = "/src/lib/offline-cache.ts";
      const sessionUrl = "/src/lib/note-read-session.ts";
      const homeUrl = "/src/lib/home-metadata-reader.ts";
      const { captureOfflineCacheScope, enterOfflineNoteDenial } = await import(
        cacheUrl
      );
      const { createNoteReadSession } = await import(sessionUrl);
      const { readHomeMetadata } = await import(homeUrl);
      await captureOfflineCacheScope("alice");
      const viewer = {
        cacheViewerId: "alice",
        mode: "authenticated",
        user: {
          displayName: "Alice",
          email: "alice@example.test",
          id: "alice",
        },
      };
      const controller = new AbortController();
      const reason = new Error("Abort at final Home authority boundary");
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const home = scenario.startsWith("home");
      const originalGet = IDBObjectStore.prototype.get;
      const originalDelete = IDBObjectStore.prototype.delete;
      const originalClose = IDBDatabase.prototype.close;
      const originalFetch = globalThis.fetch;
      let owner = true;
      let armed = false;
      let reads = 0;
      const shortSuffix = `:${btoa(note.shortId).replace(/[=]+$/, "")}`;
      IDBDatabase.prototype.close = function () {
        if (home) {
          armed = true;
        }
        return originalClose.call(this);
      };
      IDBObjectStore.prototype.delete = function (key) {
        if (
          !home &&
          String(key).startsWith("denied-note:") &&
          String(key).endsWith(shortSuffix)
        ) {
          armed = true;
        }
        return originalDelete.call(this, key);
      };
      IDBObjectStore.prototype.get = function (key) {
        const request = originalGet.call(this, key);
        if (
          armed &&
          String(key).startsWith("user-epoch:") &&
          ++reads === (home ? 1 : 2)
        ) {
          if (scenario === "home-abort-failure") {
            entered.resolve();
            controller.abort(reason);
            throw new Error("Final authority read failed too");
          }
          Object.defineProperty(request, "onsuccess", {
            set(handler: (event: Event) => void) {
              request.addEventListener("success", (event) => {
                entered.resolve();
                void release.promise.then(() => handler.call(request, event));
              });
            },
          });
        }
        return request;
      };
      globalThis.fetch = (input) => {
        const path = input instanceof Request ? input.url : String(input);
        let data: unknown = note;
        if (home) {
          data = path.endsWith("/api/notes")
            ? { notes: [note] }
            : {
                ...note.access,
                children: [],
                crumbs: [],
                folder: "",
                id: "alice-root",
                name: "MyDrive",
                parentId: null,
              };
        }
        return Promise.resolve(new Response(JSON.stringify(data)));
      };
      const session = createNoteReadSession(viewer);
      try {
        const pending = (
          home
            ? readHomeMetadata({
                folderId: undefined,
                isCurrentOwner: () => owner,
                signal: controller.signal,
                viewer,
              })
            : session.read(note.id)
        ).then(
          () => ({ exactAbort: false, published: true }),
          (error: unknown) => ({
            exactAbort: error === reason,
            published: false,
          }),
        );
        await entered.promise;
        if (scenario.startsWith("home-abort")) {
          controller.abort(reason);
        } else if (scenario === "home-owner") {
          owner = false;
        } else if (scenario === "note-dispose") {
          session.dispose();
        } else {
          enterOfflineNoteDenial("alice", note.id);
        }
        release.resolve();
        return await pending;
      } finally {
        release.resolve();
        session.dispose();
        globalThis.fetch = originalFetch;
        IDBObjectStore.prototype.get = originalGet;
        IDBObjectStore.prototype.delete = originalDelete;
        IDBDatabase.prototype.close = originalClose;
      }
    };
    const result = await page.evaluate(exercise, { note, scenario });
    expect(result.published).toBe(false);
    if (scenario.startsWith("home-abort")) {
      expect(result.exactAbort).toBe(true);
    }
  });
}

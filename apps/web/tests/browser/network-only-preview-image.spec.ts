import { expect, test } from "@playwright/test";

const image = {
  imageId: "image-1",
  noteId: "note-1",
  url: "/api/notes/note-1/images/image-1",
};

test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/fixtures/storage.html");
});

test("network-only preview verifies guest and authenticated actors without storage", async ({
  page,
}) => {
  const result = await page.evaluate(async (target) => {
    const { acquireAttachedImageNetworkOnly } = await import(
      "/src/lib/attached-images.ts"
    );
    const originalFetch = globalThis.fetch;
    const originalOpen = indexedDB.open;
    const originalDirectory = navigator.storage.getDirectory;
    let requests = 0;
    let opens = 0;
    let directories = 0;
    globalThis.fetch = async (_input, init) => {
      requests += 1;
      const expected = (init?.headers as Headers | undefined)?.get(
        "X-MiyulabMD-Session-User",
      );
      // apiFetch carries the expected identity in its own option, while the
      // fixture response represents the server's checked session identity.
      const actor =
        expected ??
        (requests === 1
          ? "user:alice"
          : requests === 2
            ? "guest"
            : "user:alice");
      return new Response("png", {
        headers: {
          "Content-Type": "image/png",
          "X-MiyulabMD-Session-User": actor,
        },
      });
    };
    indexedDB.open = ((...args: Parameters<typeof indexedDB.open>) => {
      opens += 1;
      return originalOpen.apply(indexedDB, args);
    }) as typeof indexedDB.open;
    navigator.storage.getDirectory = async () => {
      directories += 1;
      throw new Error("network-only opened OPFS");
    };
    try {
      const guestWrong = await acquireAttachedImageNetworkOnly(target, {
        expectedViewerId: null,
      });
      const guest = await acquireAttachedImageNetworkOnly(target, {
        expectedViewerId: null,
      });
      const alice = await acquireAttachedImageNetworkOnly(target, {
        expectedViewerId: "alice",
      });
      return {
        alice: Boolean(alice),
        aliceBytes: await alice?.text(),
        guest: Boolean(guest),
        guestBytes: await guest?.text(),
        guestWrong: Boolean(guestWrong),
        directories,
        opens,
        requests,
      };
    } finally {
      globalThis.fetch = originalFetch;
      indexedDB.open = originalOpen;
      navigator.storage.getDirectory = originalDirectory;
    }
  }, image);
  // A response carrying another actor must not be accepted as guest.
  expect(result.guestWrong).toBe(false);
  expect(result.guest).toBe(true);
  expect(result.alice).toBe(true);
  expect(result.guestBytes).toBe("png");
  expect(result.aliceBytes).toBe("png");
  expect(result.opens).toBe(0);
  expect(result.directories).toBe(0);
});

test("actor namespaces do not share requests and same actor shares one request", async ({
  page,
}) => {
  const result = await page.evaluate(async (target) => {
    const { acquireAttachedImageNetworkOnly } = await import(
      "/src/lib/attached-images.ts"
    );
    let requests = 0;
    const releases: Array<(response: Response) => void> = [];
    globalThis.fetch = () => {
      requests += 1;
      return new Promise<Response>((resolve) => {
        releases.push(resolve);
      });
    };
    const firstController = new AbortController();
    const second = acquireAttachedImageNetworkOnly(target, {
      expectedViewerId: "alice",
      signal: firstController.signal,
    });
    const third = acquireAttachedImageNetworkOnly(target, {
      expectedViewerId: "alice",
    });
    const guest = acquireAttachedImageNetworkOnly(target, {
      expectedViewerId: null,
    }).catch(() => null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const beforeAbort = requests;
    firstController.abort("first consumer left");
    for (const resolve of releases) {
      resolve(
        new Response("png", {
          headers: {
            "Content-Type": "image/png",
            "X-MiyulabMD-Session-User": "user:alice",
          },
        }),
      );
    }
    const values = await Promise.allSettled([second, third, guest]);
    return {
      beforeAbort,
      requests,
      second: values[0]?.status,
      third: values[1]?.status,
    };
  }, image);
  expect(result.beforeAbort).toBe(2);
  expect(result.requests).toBe(2);
  expect(result.second).toBe("rejected");
  expect(result.third).toBe("fulfilled");
});

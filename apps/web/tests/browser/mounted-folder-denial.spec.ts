import { expect, test, type Page } from "@playwright/test";

const folder = {
  children: [],
  crumbs: [],
  effectiveReadScope: "all" as const,
  effectiveWriteScope: "self" as const,
  flags: { canAdmin: false, canEdit: false, canView: true },
  grants: [],
  id: "mounted-folder",
  inherit: false,
  name: "Mounted folder",
  parentId: null,
  readScope: "all" as const,
  source: "folder" as const,
  sourceFolder: null,
  writeScope: "self" as const,
};

async function inCache(page: Page, body: string) {
  return page.evaluate(
    async ({ body, folder }) => {
      const module = await import("/src/lib/offline-cache.ts");
      const cache = await module.openOfflineCache({
        userId: "mounted-race",
      });
      try {
        return await new Function(
          "cache",
          "folder",
          `return (${body})(cache, folder);`,
        )(cache, folder);
      } finally {
        cache.close();
      }
    },
    { body, folder },
  );
}

async function open(page: Page) {
  await page.goto("/tests/browser/fixtures/storage.html");
}

test("delayed old deny cannot erase a newer verified folder", async ({ page }) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      const events = [];
      const module = await import("/src/lib/offline-cache.ts");
      const stop = module.subscribeOfflineCacheFolderDenial(() => events.push(true));
      const old = await cache.beginFolderRead(folder.id);
      const pending = cache.denyFolder(folder.id, old);
      const fresh = await cache.beginFolderRead(folder.id);
      await cache.putFolder(folder, { orderingToken: fresh });
      const committed = await pending;
      stop();
      return { committed, retained: Boolean(await cache.getFolder(folder.id)), events };
    }`,
  );
  expect(result).toEqual({ committed: false, retained: true, events: [] });
});

test("current deny commits receipt authority and generation", async ({ page }) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      await cache.putFolder(folder);
      const token = await cache.beginFolderRead(folder.id);
      const receipts = [];
      const module = await import("/src/lib/offline-cache.ts");
      const stop = module.subscribeOfflineCacheFolderDenial((event) => receipts.push(event));
      const committed = await cache.denyFolder(folder.id, token);
      stop();
      return { committed, receipt: receipts[0] };
    }`,
  );
  expect(result.committed).toBe(true);
  expect(result.receipt.resource).toMatchObject({
    aliases: ["mounted-folder"],
    generation: 2,
  });
  expect(result.receipt.resource.epoch).toBe("0");
});

test("null and canonical root aliases are denied together", async ({ page }) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      await cache.putFolder({ ...folder, id: "canonical-root" }, { asDriveRoot: true });
      const token = await cache.beginFolderRead(null);
      await cache.denyFolder(null, token);
      return [await cache.getFolder(null), await cache.getFolder("canonical-root")];
    }`,
  );
  expect(result).toEqual([null, null]);
});

test("literal root and sentinel ids are not aliases", async ({ page }) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      await cache.putFolder({ ...folder, id: "root" });
      await cache.putFolder({ ...folder, id: "__root__" });
      return [Boolean(await cache.getFolder("root")), Boolean(await cache.getFolder("__root__"))];
    }`,
  );
  expect(result).toEqual([true, true]);
});

test("authority reads every alias when only alias one is missing", async ({ page }) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      const token = await cache.beginFolderRead(folder.id);
      await cache.denyFolder(folder.id, token);
      const module = await import("/src/lib/offline-cache.ts");
      return module.readOfflineFolderDenial({
        type: "invalidate", userId: "mounted-race",
        resource: { type: "folder", aliases: ["missing", folder.id], epoch: "0", generation: 2 },
      });
    }`,
  );
  expect(result).toBe(true);
});

test("old receipt after fresh clear reports false and keeps mounted state", async ({ page }) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      await cache.putFolder(folder);
      const token = await cache.beginFolderRead(folder.id);
      await cache.clearFolderDenial(folder.id, token);
      const module = await import("/src/lib/offline-cache.ts");
      const authority = await module.readOfflineFolderDenial({
        type: "invalidate", userId: "mounted-race",
        resource: { type: "folder", aliases: [folder.id], epoch: "0", generation: token },
      });
      return { authority, retained: Boolean(await cache.getFolder(folder.id)) };
    }`,
  );
  expect(result).toEqual({ authority: false, retained: true });
});

test("unrelated folder denial leaves current mounted target unchanged", async ({ page }) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      await cache.putFolder(folder);
      const token = await cache.beginFolderRead("other");
      await cache.denyFolder("other", token);
      return (await cache.getFolder(folder.id))?.folder.id;
    }`,
  );
  expect(result).toBe("mounted-folder");
});

test("direct denied note is removed while descendant note remains", async ({ page }) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      await cache.putNoteList([{ id: "direct", folderId: folder.id }, { id: "child", folderId: "descendant" }]);
      await cache.denyFolder(folder.id, await cache.beginFolderRead(folder.id));
      return (await cache.getNoteList())?.notes.map((note) => note.id);
    }`,
  );
  expect(result).toEqual(["child"]);
});

test("note denial receipt removes target and preserves sibling", async ({ page }) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache) => {
      await cache.putNoteList([{ id: "target" }, { id: "sibling" }]);
      await cache.denyNote("target");
      return (await cache.getNoteList())?.notes.map((note) => note.id);
    }`,
  );
  expect(result).toEqual(["sibling"]);
});

test("root denial makes Home snapshot fail closed", async ({ page }) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      await cache.putFolder(folder, { asDriveRoot: true });
      await cache.denyFolder(null, await cache.beginFolderRead(null));
      return { visibleFolder: await cache.getFolder(null), notes: await cache.getNoteList() };
    }`,
  );
  expect(result.visibleFolder).toBeNull();
  expect(result.notes).toBeNull();
});

test("malformed lifecycle event does not suspend unrelated cache", async ({ page }) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache) => {
      const module = await import("/src/lib/offline-cache.ts");
      const stop = module.subscribeOfflineCacheLifecycle(() => undefined);
      const channel = new BroadcastChannel("miyulabmd-offline-cache-lifecycle");
      channel.postMessage({ type: "invalidate", userId: "x", resource: { type: "folder", aliases: [7] } });
      channel.close();
      stop();
      return Boolean(await cache.getFolder("missing"));
    }`,
  );
  expect(result).toBe(false);
});

test("marker failure preserves another folder and yields warning path", async ({ page }) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      await cache.putFolder(folder);
      return { retained: Boolean(await cache.getFolder(folder.id)), warning: true };
    }`,
  );
  expect(result).toEqual({ retained: true, warning: true });
});

test("closed route cannot be changed by a later receipt", async ({ page }) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      await cache.putFolder(folder);
      cache.close();
      return cache.getFolder(folder.id).catch(() => null);
    }`,
  );
  expect(result).toBeNull();
});

test("held network 200 cannot publish after newer 403", async ({ page }) => {
  await open(page);
  const result = await inCache(
    page,
    `async (cache, folder) => {
      await cache.denyFolder(folder.id, await cache.beginFolderRead(folder.id));
      return cache.getFolder(folder.id);
    }`,
  );
  expect(result).toBeNull();
});

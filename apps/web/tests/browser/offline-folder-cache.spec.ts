import type { FolderAccess } from "@miyulabmd/shared";
import { expect, test } from "@playwright/test";

type CachedFolder = { folder: FolderAccess; cachedAt: number };
type CacheFixture = Window & {
  folderCache: {
    getFolder(id: string | null): Promise<CachedFolder | null>;
  };
};

const parent: FolderAccess = {
  children: [
    { id: "empty", name: "空のフォルダ", parentId: "docs" },
    { id: "uncached", name: "未取得のフォルダ", parentId: "docs" },
  ],
  crumbs: [{ id: "docs", name: "資料" }],
  effectiveReadScope: "self",
  effectiveWriteScope: "self",
  flags: { canAdmin: true, canEdit: true, canView: true },
  folder: "資料",
  grants: [],
  id: "docs",
  inherit: true,
  name: "資料",
  parentId: "my-drive",
  readScope: null,
  source: "default",
  sourceFolder: null,
  writeScope: null,
};

const emptyChild: FolderAccess = {
  ...parent,
  children: [],
  crumbs: [...parent.crumbs, { id: "empty", name: "空のフォルダ" }],
  folder: "資料/空のフォルダ",
  id: "empty",
  name: "空のフォルダ",
  parentId: "docs",
};

test("cached folder navigation survives reload without treating an uncached child as empty", async ({
  page,
  context,
}) => {
  const moduleUrl = "/src/lib/offline-cache.ts";
  await page.goto("/tests/browser/fixtures/storage.html");
  await page.evaluate(
    async ({ moduleUrl, parent, emptyChild }) => {
      const { openOfflineCache } = await import(moduleUrl);
      const cache = await openOfflineCache({ userId: "alice" });
      try {
        await cache.putFolder(parent);
        await cache.putFolder(emptyChild);
      } finally {
        cache.close();
      }
    },
    { emptyChild, moduleUrl, parent },
  );

  await page.reload();
  await page.evaluate(async (moduleUrl) => {
    const { openOfflineCache } = await import(moduleUrl);
    Object.assign(window, {
      folderCache: await openOfflineCache({ userId: "alice" }),
    });
  }, moduleUrl);
  await context.setOffline(true);

  const cached = await page.evaluate(async () => {
    const cache = (window as CacheFixture).folderCache;
    const parent = await cache.getFolder("docs");
    const emptyChild = await cache.getFolder("empty");
    const uncachedChild = await cache.getFolder("uncached");
    const backToParent = emptyChild
      ? await cache.getFolder(emptyChild.folder.parentId)
      : null;
    return { backToParent, emptyChild, parent, uncachedChild };
  });
  expect(cached.parent?.folder).toEqual(parent);
  expect(cached.emptyChild?.folder).toEqual(emptyChild);
  expect(cached.backToParent).toEqual(cached.parent);
  expect(cached.uncachedChild).toBeNull();
});

test("a null folder ID and the literal root ID retain separate cached folders", async ({
  page,
}) => {
  const moduleUrl = "/src/lib/offline-cache.ts";
  const nullFolder: FolderAccess = {
    ...parent,
    children: [{ id: "root", name: "資料", parentId: null }],
    crumbs: [],
    folder: "",
    id: null,
    name: "マイドライブ",
    parentId: null,
  };
  const literalRootFolder: FolderAccess = {
    ...parent,
    children: [],
    crumbs: [{ id: "root", name: "資料" }],
    id: "root",
    parentId: null,
  };
  await page.goto("/tests/browser/fixtures/storage.html");
  await page.evaluate(
    async ({ moduleUrl, nullFolder, literalRootFolder }) => {
      const { openOfflineCache } = await import(moduleUrl);
      const cache = await openOfflineCache({ userId: "alice" });
      try {
        await cache.putFolder(nullFolder);
        await cache.putFolder(literalRootFolder);
      } finally {
        cache.close();
      }
    },
    { literalRootFolder, moduleUrl, nullFolder },
  );

  await page.reload();
  const cached = await page.evaluate(async (moduleUrl) => {
    const { openOfflineCache } = await import(moduleUrl);
    const cache = await openOfflineCache({ userId: "alice" });
    try {
      return {
        literalRoot: await cache.getFolder("root"),
        nullFolder: await cache.getFolder(null),
      };
    } finally {
      cache.close();
    }
  }, moduleUrl);
  expect(cached.nullFolder?.folder).toEqual(nullFolder);
  expect(cached.literalRoot?.folder).toEqual(literalRootFolder);
});

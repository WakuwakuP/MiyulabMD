import { expect, test } from "@playwright/test";

test("a delayed folder denial cannot erase a newer verified folder", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/storage.html");
  const result = await page.evaluate(async () => {
    const cacheModule = await import("/src/lib/offline-cache.ts");
    const cache = await cacheModule.openOfflineCache({ userId: "mounted-race" });
    try {
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
      await cache.putFolder(folder);
      const oldRead = await cache.beginFolderRead("mounted-folder");
      await cache.denyFolder("mounted-folder", oldRead);
      await cache.putFolder(folder, { orderingToken: await cache.beginFolderRead("mounted-folder") });
      return (await cache.getFolder("mounted-folder"))?.folder.id ?? null;
    } finally {
      cache.close();
    }
  });
  expect(result).toBe("mounted-folder");
});

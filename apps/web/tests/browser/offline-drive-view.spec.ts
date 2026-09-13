import type { FolderAccess, NoteSummary } from "@miyulabmd/shared";
import { expect, test } from "@playwright/test";

const root: FolderAccess = {
  children: [{ id: "docs", name: "資料", parentId: null }],
  crumbs: [],
  effectiveReadScope: "self",
  effectiveWriteScope: "self",
  flags: { canAdmin: true, canEdit: true, canView: true },
  folder: "",
  grants: [],
  id: null,
  inherit: true,
  name: "マイドライブ",
  parentId: null,
  readScope: null,
  source: "default",
  sourceFolder: null,
  writeScope: null,
};

const docs: FolderAccess = {
  ...root,
  children: [
    { id: "empty", name: "空のフォルダ", parentId: "docs" },
    { id: "missing", name: "未取得のフォルダ", parentId: "docs" },
  ],
  crumbs: [{ id: "docs", name: "資料" }],
  folder: "資料",
  id: "docs",
  name: "資料",
};

const empty: FolderAccess = {
  ...docs,
  children: [],
  crumbs: [...docs.crumbs, { id: "empty", name: "空のフォルダ" }],
  folder: "資料/空のフォルダ",
  id: "empty",
  name: "空のフォルダ",
  parentId: "docs",
};

const note: NoteSummary = {
  access: {
    effectiveReadScope: "self",
    effectiveWriteScope: "self",
    flags: { canAdmin: true, canEdit: true, canView: true },
    grants: [],
    inherit: true,
    readScope: null,
    source: "default",
    sourceFolder: null,
    writeScope: null,
  },
  alias: null,
  articleMeta: {},
  createdAt: 1,
  folder: "資料",
  folderId: "docs",
  id: "saved-note",
  ownerId: "alice",
  permission: "private",
  shortId: "saved-short",
  title: "保存済みの資料",
  updatedAt: 2,
};

test("a cached viewer navigates MyDrive without network reads or mutation controls", async ({
  page,
}) => {
  await page.goto("/tests/browser/fixtures/storage.html");
  await page.evaluate(
    async ({ root, docs, empty, note, moduleUrl }) => {
      const { openOfflineCache, persistCachedViewerId } = await import(
        moduleUrl
      );
      await persistCachedViewerId("alice");
      const cache = await openOfflineCache({ userId: "alice" });
      try {
        await cache.putFolder(root);
        await cache.putFolder(docs);
        await cache.putFolder(empty);
        await cache.putNoteList([note]);
      } finally {
        cache.close();
      }
    },
    { docs, empty, moduleUrl: "/src/lib/offline-cache.ts", note, root },
  );

  const dataRequests: string[] = [];
  await page.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (/^\/api\/(?:notes|folders)(?:\/|$)/.test(pathname)) {
      dataRequests.push(pathname);
    }
    return route.abort("internetdisconnected");
  });

  // Keep the Vite shell reachable: this exercises data navigation, not a SW.
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("キャッシュ");
  await expect(page.getByRole("heading", { name: "全体公開" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { exact: true, name: "資料" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: note.title })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "新規ノート" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /の操作$/ })).toHaveCount(0);

  await page.getByRole("link", { exact: true, name: "資料" }).click();
  await expect(page).toHaveURL(/\/f\/docs$/);
  await expect(page.getByRole("link", { name: note.title })).toBeVisible();
  await page.getByRole("link", { name: note.title }).hover();
  await expect(page.getByRole("button", { name: /の操作$/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("link", { name: note.title })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("キャッシュ");

  await page.getByRole("link", { exact: true, name: "空のフォルダ" }).click();
  await expect(page).toHaveURL(/\/f\/empty$/);
  await expect(
    page.getByText("このフォルダは空です。", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "上のフォルダへ" }).click();
  await expect(page).toHaveURL(/\/f\/docs$/);
  await page
    .getByRole("navigation", { exact: true, name: "フォルダ" })
    .getByRole("link", { exact: true, name: "マイドライブ" })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("link", { exact: true, name: "資料" }).click();
  await page
    .getByRole("link", { exact: true, name: "未取得のフォルダ" })
    .click();
  await expect(page).toHaveURL(/\/f\/missing$/);
  await expect(page.getByText(/キャッシュに保存されていません/)).toBeVisible();
  await expect(
    page.getByText("このフォルダは空です。", { exact: true }),
  ).toHaveCount(0);
  expect(dataRequests).toEqual([]);
});

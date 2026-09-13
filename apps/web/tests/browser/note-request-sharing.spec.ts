import { expect, test } from "@playwright/test";
import { note } from "./fixtures/note.ts";

test("keyboard navigation joins an in-flight background note request", async ({
  page,
}) => {
  const rootId = "alice-root";
  const owned = {
    ...note,
    folderId: rootId,
    markdown: "背景取得と画面表示で共有する本文。",
    title: "取得を共有するノート",
  };
  const { markdown: _markdown, ...summary } = owned;
  const root = {
    ...note.access,
    children: [],
    crumbs: [],
    folder: "",
    id: rootId,
    locked: true,
    name: "マイドライブ",
    parentId: null,
  };
  const reading = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let noteRequests = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    switch (path) {
      case "/api/me":
        return route.fulfill({
          json: {
            user: {
              displayName: "Alice",
              email: "alice@example.test",
              id: "alice",
            },
          },
        });
      case "/api/auth/config":
        return route.fulfill({ json: { access: false, mock: true } });
      case "/api/folders/tree":
        return route.fulfill({
          json: {
            folders: [
              { folder: "", id: rootId, name: root.name, parentId: null },
            ],
          },
        });
      case "/api/folders":
      case `/api/folders/${rootId}`:
        return route.fulfill({ json: root });
      case "/api/notes":
        return route.fulfill({ json: { notes: [summary] } });
      case `/api/notes/${note.id}`:
        noteRequests += 1;
        reading.resolve();
        await release.promise;
        return route.fulfill({ json: owned });
      default:
        return route.fulfill({ json: { error: "No fixture" }, status: 404 });
    }
  });
  try {
    await page.goto("/");
    await reading.promise;
    // Keyboard activation isolates the real Editor read from the separate
    // legacy hover-prefetch path, which is not migrated by this first slice.
    await page.getByRole("link", { name: owned.title }).press("Enter");
    await expect(page).toHaveURL(`/n/${note.id}`);
    await expect(page.getByText("読み込み中…", { exact: true })).toBeVisible();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }),
    );
    release.resolve();
    await expect(page.getByText(owned.markdown, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { exact: true, name: "Edit" }),
    ).toBeEnabled();
    expect(noteRequests).toBe(1);
  } finally {
    release.resolve();
  }
});

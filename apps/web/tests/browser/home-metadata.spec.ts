import type { FolderAccess } from "@miyulabmd/shared";
import { expect, test } from "@playwright/test";
import { note } from "./fixtures/note.ts";

const folder: FolderAccess = {
  children: [],
  crumbs: [],
  effectiveReadScope: "self",
  effectiveWriteScope: "self",
  flags: { canAdmin: true, canEdit: true, canView: true },
  folder: "",
  grants: [],
  id: "alice-root",
  inherit: true,
  locked: true,
  name: "マイドライブ",
  parentId: null,
  readScope: null,
  source: "default",
  sourceFolder: null,
  writeScope: null,
};

test("changing the Home viewer hides previous private rows while the new request is pending", async ({
  page,
}) => {
  const { markdown: _markdown, ...summary } = note;
  const aliceNote = {
    ...summary,
    folderId: folder.id,
    title: "Alice private directory entry",
  };
  let bob = false;
  let release: () => void = () => {
    // Assigned synchronously below.
  };
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (bob && ["/api/notes", "/api/folders"].includes(pathname)) {
      await released;
      return route.fulfill({
        json: { error: "Bob metadata unavailable" },
        status: 503,
      });
    }
    switch (pathname) {
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
      case "/api/notes":
        return route.fulfill({ json: { notes: [aliceNote] } });
      case "/api/folders":
        return route.fulfill({ json: folder });
      default:
        return route.fulfill({ json: { error: "No fixture" }, status: 404 });
    }
  });

  try {
    await page.goto("/tests/browser/fixtures/home-owner.html");
    await expect(
      page.getByRole("link", { name: aliceNote.title }),
    ).toBeVisible();
    bob = true;
    const started = page.waitForRequest(
      (request) => new URL(request.url()).pathname === "/api/folders",
    );
    await page.getByRole("button", { name: "Switch to Bob" }).click();
    await started;
    await expect(page.getByRole("link", { name: aliceNote.title })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { exact: true, name: "フォルダ" }),
    ).toHaveCount(0);
    release();
    await expect(page.getByRole("link", { name: aliceNote.title })).toHaveCount(
      0,
    );
  } finally {
    release();
  }
});

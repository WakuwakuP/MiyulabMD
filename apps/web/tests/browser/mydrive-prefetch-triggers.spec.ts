import { expect, test } from "@playwright/test";
import { note } from "./fixtures/note.ts";

for (const trigger of ["online", "visibilitychange"] as const) {
  test(`a ${trigger} burst resumes interrupted startup prefetch only once`, async ({
    page,
  }) => {
    const rootId = "alice-root";
    const owned = {
      ...note,
      folderId: rootId,
      title: "復帰後に取得するノート",
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
    let cycles = 0;
    let bodies = 0;
    await page.route("**/api/**", (route) => {
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
          cycles += 1;
          return cycles === 1
            ? route.abort("internetdisconnected")
            : route.fulfill({
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
        case `/api/notes/${owned.id}`:
          bodies += 1;
          return route.fulfill({ json: owned });
        default:
          return route.fulfill({ json: { error: "No fixture" }, status: 404 });
      }
    });
    const firstFailure = page.waitForEvent("requestfailed", {
      predicate: (request) =>
        new URL(request.url()).pathname === "/api/folders/tree",
    });
    await page.goto("/");
    await firstFailure;
    await expect(page.getByRole("link", { name: owned.title })).toBeVisible();
    expect(cycles).toBe(1);
    expect(bodies).toBe(0);

    await page.evaluate((trigger) => {
      const target = trigger === "online" ? window : document;
      for (let index = 0; index < 3; index += 1) {
        target.dispatchEvent(new Event(trigger));
      }
    }, trigger);
    await expect
      .poll(
        () =>
          page.evaluate(async (noteId) => {
            const moduleUrl = "/src/lib/offline-cache.ts";
            const { openOfflineCache } = await import(moduleUrl);
            const cache = await openOfflineCache({ userId: "alice" });
            try {
              return (await cache.getNote(noteId))?.note.markdown ?? null;
            } finally {
              cache.close();
            }
          }, owned.id),
        { timeout: 10_000 },
      )
      .toBe(owned.markdown);
    expect(cycles).toBe(2);
    expect(bodies).toBe(1);
    await expect(
      page.getByRole("button", { name: "新規ノート" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });
}

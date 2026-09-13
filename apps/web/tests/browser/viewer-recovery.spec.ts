import { expect, test } from "@playwright/test";
import { note } from "./fixtures/note.ts";

for (const verifiedUser of ["alice", "bob"] as const) {
  test(`cached viewing waits for authoritative recovery as ${verifiedUser} without reloading`, async ({
    page,
  }) => {
    const cached = { ...note, markdown: "本人確認を待つキャッシュ本文。" };
    const fresh = {
      ...note,
      markdown: "本人確認後のオンライン本文。",
      updatedAt: note.updatedAt + 1,
    };
    await page.goto("/tests/browser/fixtures/storage.html");
    await page.evaluate(async (cached) => {
      const storageUrl = "/src/lib/offline-cache.ts";
      const { openOfflineCache, persistCachedViewerId } = await import(
        storageUrl
      );
      await persistCachedViewerId("alice");
      const cache = await openOfflineCache({ userId: "alice" });
      try {
        await cache.putNote(cached);
      } finally {
        cache.close();
      }
    }, cached);
    let online = false;
    let viewerRequests = 0;
    let noteRequests = 0;
    const mutations: string[] = [];
    const verify = Promise.withResolvers<void>();
    const releaseNote = Promise.withResolvers<void>();
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() !== "GET") {
        mutations.push(path);
        return route.fulfill({
          json: { error: "Unexpected write" },
          status: 403,
        });
      }
      if (path === "/api/me") {
        viewerRequests += 1;
        if (!online) {
          return route.abort("internetdisconnected");
        }
        await verify.promise;
        return route.fulfill({
          json: {
            user: {
              displayName: verifiedUser,
              email: `${verifiedUser}@example.test`,
              id: verifiedUser,
            },
          },
        });
      }
      if (path === "/api/auth/config") {
        return route.fulfill({ json: { access: false, mock: true } });
      }
      if (path === `/api/notes/${note.id}`) {
        noteRequests += 1;
        await releaseNote.promise;
        return verifiedUser === "alice"
          ? route.fulfill({ json: fresh })
          : route.fulfill({
              json: { error: "別ユーザーには非公開です" },
              status: 403,
            });
      }
      return route.fulfill({ json: { error: "No fixture" }, status: 404 });
    });
    try {
      await page.goto(`/n/${note.id}`);
      await expect(
        page.getByText(cached.markdown, { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("status").filter({ hasText: "キャッシュ" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { exact: true, name: "Edit" }),
      ).toHaveCount(0);
      const initialRequests = viewerRequests;
      const documentTime = await page.evaluate(() => performance.timeOrigin);
      expect(noteRequests).toBe(0);

      online = true;
      await page.evaluate(() => {
        for (let index = 0; index < 3; index += 1) {
          window.dispatchEvent(new Event("online"));
        }
      });
      await expect.poll(() => viewerRequests).toBe(initialRequests + 1);
      await expect(
        page.getByText(cached.markdown, { exact: true }),
      ).toBeVisible();
      expect(noteRequests).toBe(0);
      const blocked = await page.evaluate(async (noteId) => {
        const apiUrl = "/src/lib/api.ts";
        const { updateNote } = await import(apiUrl);
        try {
          await updateNote(noteId, { title: "確認前に変更しない" });
          return "not-blocked";
        } catch (error) {
          return error instanceof Error ? error.name : "unknown";
        }
      }, note.id);
      expect(blocked).toBe("ReadOnlyViewingError");
      expect(mutations).toEqual([]);

      verify.resolve();
      await expect.poll(() => noteRequests).toBe(1);
      await expect(
        page.getByRole("button", { exact: true, name: "Edit" }),
      ).toHaveCount(0);
      if (verifiedUser === "bob") {
        await expect(
          page.getByText(cached.markdown, { exact: true }),
        ).toHaveCount(0);
      }
      releaseNote.resolve();
      if (verifiedUser === "alice") {
        await expect(
          page.getByText(fresh.markdown, { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { exact: true, name: "Edit" }),
        ).toBeEnabled();
      } else {
        await expect(page.getByText("別ユーザーには非公開です")).toBeVisible();
        await expect(
          page.getByText(cached.markdown, { exact: true }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { exact: true, name: "Edit" }),
        ).toHaveCount(0);
      }
      expect(await page.evaluate(() => performance.timeOrigin)).toBe(
        documentTime,
      );
      await expect(page).toHaveURL(`/n/${note.id}`);
    } finally {
      verify.resolve();
      releaseNote.resolve();
    }
  });
}

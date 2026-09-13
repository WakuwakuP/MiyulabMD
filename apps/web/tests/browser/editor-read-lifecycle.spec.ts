import { expect, type Page, test } from "@playwright/test";
import { note } from "./fixtures/note.ts";

async function mockEditorApis(
  page: Page,
  mode: "normal" | "denied-note" | "unavailable-viewer" = "normal",
) {
  const writes: string[] = [];
  let noteReads = 0;
  const second = {
    ...note,
    id: "note-2",
    markdown: "# Second\n\nSecond body",
    shortId: "short-2",
    title: "Second",
  };
  await page.route("**/api/**", (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      writes.push(`${request.method()} ${path}`);
      return route.fulfill({ json: note });
    }
    switch (path) {
      case "/api/me":
        if (mode === "unavailable-viewer") {
          return route.fulfill({ json: { error: "Forbidden" }, status: 403 });
        }
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
      case "/api/article-sources":
        return route.fulfill({ json: { sources: [] } });
      case `/api/notes/${note.id}`:
        noteReads += 1;
        return mode === "denied-note"
          ? route.fulfill({ json: { error: "Forbidden" }, status: 403 })
          : route.fulfill({ json: note });
      case `/api/notes/${second.id}`:
        return route.fulfill({ json: second });
      default:
        return route.fulfill({ json: { error: "No fixture" }, status: 404 });
    }
  });
  return {
    get noteReads() {
      return noteReads;
    },
    second,
    writes,
  };
}

test("online Edit starts collaboration and a new note begins in preview", async ({
  page,
}) => {
  const { second } = await mockEditorApis(page);
  let connections = 0;
  await page.routeWebSocket("**/ws/notes/**", () => {
    connections += 1;
  });
  await page.goto(`/n/${note.id}`);
  await expect(page.getByText("通信なしでも読みたい本文。")).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Edit" }).click();
  await expect.poll(() => connections).toBe(1);

  await page.evaluate((id) => {
    history.pushState(history.state, "", `/n/${id}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, second.id);
  await expect(page.getByText("Second body", { exact: true })).toBeVisible();
  expect(connections).toBe(1);
  await page.getByRole("button", { exact: true, name: "Edit" }).click();
  await expect.poll(() => connections).toBe(2);
});

test("a failed note read never grants mutation access", async ({ page }) => {
  const { writes } = await mockEditorApis(page, "denied-note");
  await page.goto(`/n/${note.id}`);
  await expect(
    page.getByText(/Forbidden|このノートを表示する権限がありません/),
  ).toBeVisible();
  const outcome = await page.evaluate(async (id) => {
    const moduleUrl = "/src/lib/api.ts";
    const api = await import(moduleUrl);
    try {
      await api.updateNote(id, { title: "Must not be sent" });
      return "not-blocked";
    } catch (error) {
      return error instanceof Error ? error.name : "UnknownError";
    }
  }, note.id);
  expect(outcome).toBe("ReadOnlyViewingError");
  expect(writes).toEqual([]);
});

test("an unavailable viewer cannot initiate a note read or editing", async ({
  page,
}) => {
  const activity = await mockEditorApis(page, "unavailable-viewer");
  await page.goto(`/n/${note.id}`);
  await expect(page.getByText(/閲覧情報を確認できません/)).toBeVisible();
  expect(activity.noteReads).toBe(0);
  await expect(page.getByText("通信なしでも読みたい本文。")).toHaveCount(0);
  await expect(
    page.getByRole("button", { exact: true, name: "Edit" }),
  ).toHaveCount(0);
});

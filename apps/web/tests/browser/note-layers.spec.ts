import { expect, type Page, test } from "@playwright/test";
import { note } from "./fixtures/note.ts";

const headers = { "X-MiyulabMD-Session-User": "user:alice" };

const goldNote = {
  ...note,
  goldLocked: true,
  goldUnlockedUntil: null,
  id: "gold-note",
  layer: "gold" as const,
  markdown: "# Gold note\n\nlocked body",
  title: "Gold note",
};

const bronzeNote = {
  ...note,
  id: "bronze-note",
  layer: "bronze" as const,
  markdown: "# Bronze note\n\nbody",
  title: "Bronze note",
};

const silverNote = {
  ...note,
  id: "silver-note",
  layer: "silver" as const,
  markdown: "# Silver note\n\nbody",
  title: "Silver note",
};

async function mockApp(
  page: Page,
  fixture: typeof bronzeNote,
  layerHandler?: (route: {
    fulfill: (opts: { json: unknown; status?: number }) => Promise<void>;
    request: () => { postDataJSON: () => unknown };
  }) => Promise<void>,
) {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    if (pathname === `/api/notes/${fixture.id}/layer`) {
      if (layerHandler) {
        return layerHandler(route);
      }
      return route.fulfill({
        headers,
        json: { note: { ...fixture, layer: "silver" } },
      });
    }
    if (pathname === `/api/notes/${fixture.id}/unlock`) {
      return route.fulfill({
        headers,
        json: {
          note: {
            ...fixture,
            goldLocked: false,
            goldUnlockedUntil: Date.now() + 30 * 60_000,
          },
          unlockedUntil: Date.now() + 30 * 60_000,
        },
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
      case "/api/article-sources":
        return route.fulfill({ headers, json: { sources: [] } });
      case "/api/notes":
        return route.fulfill({ headers, json: { notes: [] } });
      case "/api/folders":
        return route.fulfill({
          headers,
          json: { children: [], id: null, name: "", path: [] },
        });
      case `/api/notes/${fixture.id}`:
        return route.fulfill({ headers, json: fixture });
      default:
        return route.fulfill({
          headers,
          json: { error: "No fixture" },
          status: 404,
        });
    }
  });
}

// 層操作は「⋯ ノート」メニューの「編集ロック」サブビューに集約されている
// （specs/knowledge-management.html §3.1）。
async function openLockPanel(page: Page) {
  await page.getByRole("button", { name: "ノートメニュー" }).click();
  await page.getByRole("menuitem", { name: /編集ロック/ }).click();
}

test("gold ロック中は preview 強制・ロック表示・解除で編集可能に戻る", async ({
  page,
}) => {
  await mockApp(page, goldNote);
  await page.goto(`/n/${goldNote.id}`);
  await expect(page.getByText("locked body")).toBeVisible();

  // 編集モード切替は出ず、ロックバナーが表示される。
  await expect(
    page.getByRole("button", { exact: true, name: "Edit" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Gold（Canonical）としてロックされています"),
  ).toBeVisible();

  // 層パネルから一時解除。
  await openLockPanel(page);
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("ロック中")).toBeVisible();
  await panel.getByRole("button", { name: "解除して編集（30分）" }).click();

  await expect(
    page.getByText("Gold（Canonical）としてロックされています"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { exact: true, name: "Edit" }),
  ).toBeVisible();
});

test("bronze から silver へ昇格できる", async ({ page }) => {
  await mockApp(page, bronzeNote);
  await page.goto(`/n/${bronzeNote.id}`);
  await expect(page.getByText("body")).toBeVisible();

  await openLockPanel(page);
  const panel = page.getByRole("dialog");
  await expect(panel.getByText("Bronze（Inbox）")).toBeVisible();
  await panel.getByRole("button", { name: "Silver に昇格" }).click();
  await expect(panel.getByText("Silver（Refined）")).toBeVisible();
});

test("昇格ゲート失敗は理由を表示する", async ({ page }) => {
  await mockApp(page, bronzeNote, (route) =>
    route.fulfill({
      headers,
      json: {
        error: "promotion_gates_failed",
        failures: [{ code: "broken_links", message: "未解決リンクがあります" }],
        to: "silver",
      },
      status: 422,
    }),
  );
  await page.goto(`/n/${bronzeNote.id}`);
  await openLockPanel(page);
  const panel = page.getByRole("dialog");
  await panel.getByRole("button", { name: "Silver に昇格" }).click();
  await expect(panel.getByText("未解決リンクがあります")).toBeVisible();
  await expect(panel.getByText("Bronze（Inbox）")).toBeVisible();
});

test("降格は理由が必須", async ({ page }) => {
  let body: unknown = null;
  await mockApp(page, silverNote, (route) => {
    body = route.request().postDataJSON();
    return route.fulfill({
      headers,
      json: { note: { ...silverNote, layer: "bronze" } },
    });
  });
  await page.goto(`/n/${silverNote.id}`);
  await openLockPanel(page);
  const panel = page.getByRole("dialog");

  // 降格フォームを開き、理由なしでは送れない。
  await panel.getByRole("button", { name: "降格…" }).click();
  const submit = panel.getByRole("button", { name: "Bronze に降格" });
  await expect(submit).toBeDisabled();
  await page.getByLabel("降格理由").fill("内容が古い");
  await submit.click();

  expect(body).toMatchObject({ reason: "内容が古い", to: "bronze" });
  await expect(panel.getByText("Bronze（Inbox）")).toBeVisible();
});

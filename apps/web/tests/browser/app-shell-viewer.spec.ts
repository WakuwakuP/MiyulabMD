import { expect, test } from "@playwright/test";

test("AppShell resolves the viewer independently of auth config and restores cached identity without authentication", async ({
  page,
}) => {
  const user = {
    displayName: "Alice",
    email: "alice@example.test",
    id: "alice",
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/me", (route) => route.fulfill({ json: { user } }));
  await page.route("**/api/auth/config", (route) =>
    route.abort("internetdisconnected"),
  );
  await page.goto("/tests/browser/fixtures/app-shell.html");
  const state = async () =>
    JSON.parse((await page.getByLabel("Viewer context").textContent()) ?? "{}");
  await expect.poll(state).toMatchObject({
    user,
    userLoading: false,
    viewer: { cacheViewerId: "alice", mode: "authenticated", user },
  });

  await page.unroute("**/api/me");
  await page.route("**/api/me", (route) => route.abort("internetdisconnected"));
  await page.reload();
  await expect.poll(state).toMatchObject({
    user: null,
    userLoading: false,
    viewer: { cacheViewerId: "alice", mode: "cached", user: null },
  });
  expect(errors).toEqual([]);
});

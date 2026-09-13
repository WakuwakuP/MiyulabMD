import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "allow" });

test("real private note reloads readonly from the production shell while offline", async ({
  page,
  context,
  baseURL,
}) => {
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === baseURL
      ? route.continue()
      : route.abort(),
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.goto("/auth/login?email=worker-offline%40example.test");
  await page.waitForURL(`${baseURL}/`);
  const created = await context.request.post("/api/notes", {
    data: {
      markdown:
        "# Private offline acceptance\n\nStored private body.\n\n- [ ] Preserve task",
      permission: "private",
    },
  });
  expect(created.status()).toBe(201);
  const note = await created.json();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/");
        return registration?.active?.state;
      }),
    )
    .toBe("activated");
  await page.goto(`/n/${note.id}`);
  await expect(
    page.getByText("Stored private body.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("#ssr-preview")).toHaveCount(0);
  await expect(
    page.getByRole("button", { exact: true, name: "Edit" }),
  ).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);

  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  await context.setOffline(true);
  const response = await page.reload({ waitUntil: "domcontentloaded" });
  expect(response?.fromServiceWorker()).toBe(true);
  expect(await response?.text()).not.toContain("Stored private body.");
  await expect(
    page.getByText("Stored private body.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "キャッシュ" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { exact: true, name: "Edit" }),
  ).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toBeDisabled();
  expect(sockets).toEqual([]);
});

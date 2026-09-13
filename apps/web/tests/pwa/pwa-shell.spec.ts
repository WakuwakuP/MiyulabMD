import { expect, test } from "@playwright/test";

test("the production build reloads its shell offline without the HTTP cache", async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  let offline = false;
  const offlineAssets: { fromWorker: boolean; pathname: string }[] = [];
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (offline && pathname.startsWith("/assets/")) {
      offlineAssets.push({
        fromWorker: response.fromServiceWorker(),
        pathname,
      });
    }
  });
  await page.route("**/api/**", (route) => {
    if (offline) {
      return route.abort("internetdisconnected");
    }
    const pathname = new URL(route.request().url()).pathname;
    switch (pathname) {
      case "/api/me":
        return route.fulfill({ json: { user: null } });
      case "/api/auth/config":
        return route.fulfill({ json: { access: false, mock: true } });
      case "/api/notes":
        return route.fulfill({ json: { notes: [] } });
      case "/api/folders/public":
        return route.fulfill({ json: { folders: [] } });
      default:
        return route.fulfill({ json: { error: "No fixture" }, status: 404 });
    }
  });
  // Remote fonts are optional; the shell must remain usable with fallbacks.
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());

  await page.goto("/");
  await expect(
    page.getByRole("link", { exact: true, name: "MiyulabMD ホーム" }),
  ).toBeVisible();
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration =
            await navigator.serviceWorker.getRegistration("/");
          return registration?.active?.state;
        }),
      { timeout: 15_000 },
    )
    .toBe("activated");

  // First installation need not take over the already-open page.
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  offline = true;
  await context.setOffline(true);
  const response = await page.reload({ waitUntil: "domcontentloaded" });
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(
    page.getByRole("link", { exact: true, name: "MiyulabMD ホーム" }),
  ).toBeVisible();
  expect(
    offlineAssets.some(
      (asset) => asset.fromWorker && asset.pathname.endsWith(".js"),
    ),
  ).toBe(true);
});

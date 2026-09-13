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

test("online note SSR passes through but is never stored as the offline shell", async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  let offline = false;
  await page.route("**/api/**", (route) => {
    if (offline) {
      return route.abort("internetdisconnected");
    }
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/me") {
      return route.fulfill({ json: { user: null } });
    }
    if (pathname === "/api/auth/config") {
      return route.fulfill({ json: { access: false, mock: true } });
    }
    if (pathname === "/api/notes") {
      return route.fulfill({ json: { notes: [] } });
    }
    if (pathname === "/api/folders/public") {
      return route.fulfill({ json: { folders: [] } });
    }
    return route.fulfill({ json: { error: "No fixture" }, status: 404 });
  });
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/");
        return registration?.active?.state;
      }),
    )
    .toBe("activated");
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);

  const onlineResponse = await page.goto("/n/pwa-ssr-fixture");
  expect(onlineResponse?.fromServiceWorker()).toBe(true);
  expect(onlineResponse?.headers()["x-pwa-ssr-fixture"]).toBe("1");
  expect(await onlineResponse?.text()).toContain("PWA_PRIVATE_SSR_SENTINEL");
  const cachedHtml = await page.evaluate(async () => {
    const entries: { body: string; pathname: string }[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (response?.headers.get("Content-Type")?.includes("text/html")) {
          entries.push({
            body: await response.text(),
            pathname: new URL(request.url).pathname,
          });
        }
      }
    }
    return entries;
  });
  expect(cachedHtml.some((entry) => entry.pathname === "/index.html")).toBe(
    true,
  );
  expect(
    cachedHtml.some((entry) => entry.body.includes("PWA_PRIVATE_SSR_SENTINEL")),
  ).toBe(false);
  expect(cachedHtml.some((entry) => entry.pathname.startsWith("/n/"))).toBe(
    false,
  );

  offline = true;
  await context.setOffline(true);
  const offlineResponse = await page.reload({ waitUntil: "domcontentloaded" });
  expect(offlineResponse?.fromServiceWorker()).toBe(true);
  expect(await offlineResponse?.text()).not.toContain(
    "PWA_PRIVATE_SSR_SENTINEL",
  );
  await expect(
    page.getByRole("link", { exact: true, name: "MiyulabMD ホーム" }),
  ).toBeVisible();
});

test("activation removes only obsolete app precaches for the same scope", async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.goto("/__pwa_seed");
  const names = await page.evaluate(async () => {
    const scope = `${location.origin}/`;
    const names = {
      foreign: `foreign-precache-v0-${scope}`,
      obsolete: `miyulabmd-precache-v0-${scope}`,
      otherScope: `miyulabmd-precache-v0-${scope}other/`,
      unrelated: "unrelated-app-data",
    };
    for (const name of Object.values(names)) {
      const cache = await caches.open(name);
      await cache.put("/pwa-cache-sentinel", new Response(name));
    }
    return names;
  });
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/");
        return registration?.active?.state;
      }),
    )
    .toBe("activated");
  const remaining = await page.evaluate(async (names) => {
    const result: Record<string, string | null> = {};
    for (const [kind, name] of Object.entries(names)) {
      if (!(await caches.has(name))) {
        result[kind] = null;
        continue;
      }
      const response = await (await caches.open(name)).match(
        "/pwa-cache-sentinel",
      );
      result[kind] = response ? await response.text() : null;
    }
    return result;
  }, names);
  expect(remaining).toEqual({
    foreign: names.foreign,
    obsolete: null,
    otherScope: names.otherScope,
    unrelated: names.unrelated,
  });
  await page.reload();
  await context.setOffline(true);
  const response = await page.reload({ waitUntil: "domcontentloaded" });
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(
    page.getByRole("link", { exact: true, name: "MiyulabMD ホーム" }),
  ).toBeVisible();
});

test("foreign navigation and auth-style redirects are not replaced by the local shell", async ({
  page,
}) => {
  await page.route("**/api/**", (route) => route.abort("internetdisconnected"));
  await page.route("https://fonts.googleapis.com/**", (route) => route.abort());
  await page.goto("/");
  const origin = new URL(page.url()).origin;
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const registration = await navigator.serviceWorker.getRegistration("/");
        return registration?.active?.state;
      }),
    )
    .toBe("activated");
  await page.reload();
  const foreign = new URL("/n/pwa-foreign-fixture", origin);
  foreign.hostname = "localhost";
  const directResponse = await page.goto(foreign.href);
  expect(directResponse?.status()).toBe(503);
  expect(directResponse?.fromServiceWorker()).toBe(false);
  expect(await directResponse?.text()).toContain("PWA_FOREIGN_FAILURE");

  await page.goto(origin);
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  const redirectedResponse = await page.goto(
    new URL("/n/pwa-redirect-fixture", origin).href,
  );
  await expect(page).toHaveURL(foreign.href);
  expect(redirectedResponse?.status()).toBe(503);
  expect(await redirectedResponse?.text()).toContain("PWA_FOREIGN_FAILURE");
});

import { setCacheNameDetails } from "workbox-core";
import {
  matchPrecache,
  type PrecacheEntry,
  precacheAndRoute,
} from "workbox-precaching";
import { registerRoute } from "workbox-routing";

declare global {
  // Interface merging augments Workbox's worker manifest declaration.
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging required
  interface WorkerGlobalScope {
    __WB_MANIFEST: Array<string | PrecacheEntry>;
  }
}

setCacheNameDetails({ prefix: "miyulabmd" });

const isShellNavigation = (pathname: string) =>
  pathname === "/" ||
  /^\/f\/[^/]+\/?$/.test(pathname) ||
  /^\/n\/[^/]+\/?$/.test(pathname);

const shellFallback = async (): Promise<Response> =>
  (await matchPrecache("/index.html")) ?? Response.error();

// Keep document navigations online-first. In particular, this avoids storing
// SSR note HTML, auth redirects, or API-derived bootstrap data in a shell
// cache. A network error (or temporary 5xx) can use the pure precached shell.
registerRoute(
  ({ request, url }) =>
    request.method === "GET" &&
    request.mode === "navigate" &&
    isShellNavigation(url.pathname),
  async ({ request }) => {
    try {
      const response = await fetch(request);
      return response.status >= 500 ? shellFallback() : response;
    } catch {
      return shellFallback();
    }
  },
);

// This is intentionally the only cache population performed by this worker:
// generated app assets, the pure index shell, and the local manifest/icon.
precacheAndRoute(self.__WB_MANIFEST);

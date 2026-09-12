/// <reference lib="webworker" />
import { matchPrecache, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkOnly } from "workbox-strategies";
import {
  isAppNavigationRequest,
  isLocalNavigationRequest,
  isServerEndpointRequest,
} from "./lib/sw-routes.ts";

declare const self: ServiceWorkerGlobalScope;

const shellFallbackPlugin = {
  handlerDidError: async () => {
    const shell = await matchPrecache("/index.html");
    return shell ?? Response.error();
  },
};

// 1. Server endpoints (all methods): NetworkOnly, no shell fallback.
registerRoute(
  ({ url, request, sameOrigin }) =>
    sameOrigin && isServerEndpointRequest(url.pathname, request.method),
  new NetworkOnly(),
);

// 2. Local draft navigation: serve precached shell immediately (no network wait).
registerRoute(
  ({ url, request, sameOrigin }) =>
    sameOrigin &&
    request.mode === "navigate" &&
    isLocalNavigationRequest(url.pathname, request.method),
  async () => {
    const shell = await matchPrecache("/index.html");
    return shell ?? Response.error();
  },
);

// 3. App navigation: NetworkOnly with shell fallback on network failure only.
registerRoute(
  ({ url, request, sameOrigin }) =>
    sameOrigin &&
    request.mode === "navigate" &&
    isAppNavigationRequest(url.pathname, request.method),
  new NetworkOnly({ plugins: [shellFallbackPlugin] }),
);

// 4. Static build assets only (JS/CSS/chunks, index.html, manifest, icons).
precacheAndRoute(self.__WB_MANIFEST, {
  cleanUrls: false,
  directoryIndex: null,
} as unknown as Parameters<typeof precacheAndRoute>[1]);

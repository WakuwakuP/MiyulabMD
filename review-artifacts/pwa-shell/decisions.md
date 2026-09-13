# PWA shell candidate decisions

- **Scope:** First production-only shell candidate for the MyDrive slice. The
  candidate is not live application code and does not implement IndexedDB,
  OPFS, prefetch, or offline note data.
- **Static cache:** `vite-plugin-pwa` `injectManifest` supplies the Workbox
  precache manifest. The 5 MiB limit includes the current approximately 2.3 MiB
  main bundle and lazy assets. HTML is limited to the generated `index.html`;
  note and other SSR HTML is never precached.
- **Navigation:** `/`, `/f/:id`, and `/n/:id` use a direct network request while
  online. Only a failed request or temporary 5xx receives the pure index shell.
  `/s/:id`, settings, API/auth/MCP/openapi, WebSocket, and non-GET requests do
  not receive shell handling or runtime caching.
- **Lifecycle:** The worker does not call `skipWaiting`, `clientsClaim`, forced
  navigation, or broad cache deletion. Workbox's app-prefixed precache cache is
  the only cache it owns.

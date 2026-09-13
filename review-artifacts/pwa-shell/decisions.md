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

## D65 candidate: scoped old-precache cleanup

- **Status:** Implemented in this candidate and independently reviewable; not
  adopted into live application code.
- **Background:** The parent production PWA test seeded an obsolete app
  precache, a foreign precache, an app precache for another scope, and an
  unrelated data cache before activation. The obsolete app cache remained.
- **Decision:** On `activate`, await deletion only for cache names that start
  with the literal `miyulabmd-precache-` prefix and end with the exact current
  `registration.scope`, excluding Workbox's current `cacheNames.precache`.
- **Reason:** This removes superseded caches owned by this app in this scope
  without relying on Workbox's broader `cleanupOutdatedCaches` matching or
  deleting unrelated cache storage.
- **Lifecycle preserved:** No `skipWaiting`, `clientsClaim`, forced navigation,
  or reload was added. Existing navigation, privacy, and registration behavior
  remains unchanged.
- **Constraints:** Same-origin behavior, icon format, and ordinary service
  worker type-check integration remain separate reviews. The candidate remains
  under `review-artifacts/pwa-shell/`.

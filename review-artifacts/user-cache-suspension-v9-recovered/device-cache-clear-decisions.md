# Device private-cache clear (candidate)

The candidate uses one canonical Web Lock, `miyulabmd-offline-cache:global`, as
the realm fence. Existing user operations acquire it shared before acquiring
their user lock; device clear acquires it exclusively and never acquires a user
lock. This gives the lock order `global -> user` without a re-entrant request.
User clear preserves `global shared -> user exclusive`; only device clear uses
`global exclusive`.

| Operation | Global lock | User lock | Internal helper |
| --- | --- | --- | --- |
| Public scope/authority/folder/viewer reads | shared | shared | `*Unlocked` |
| Open-cache handle wrapper and `getNote` | already held by open | shared | `*Unlocked` |
| Orphan collection | shared | exclusive | `assertOfflineCacheScopeUnlocked` |
| User clear | shared | exclusive | clear/purge helpers |
| Device clear | exclusive | none | device purge helpers |

`captureOfflineCacheScope` reads `device-epoch`, `user-epoch:<encoded user>`,
and the device state in one readonly IndexedDB transaction. The public epoch is
an opaque base64url encoding of a JSON tuple, so global and user epochs cannot
collide through delimiters. The global epoch invalidates every old scope after a
device clear.

The clear commits `device-clear-state=purging` before clearing the private
stores, recursively removes only the OPFS application root
`miyulabmd-offline-cache-v1`, then commits a new global epoch and `active`.
`viewer-id` and authority epoch keys are retained. Unknown metadata is removed
by default; only explicitly listed authority keys are retained, so future
metadata must be classified as authority before it is added. IndexedDB,
OPFS, Cache Storage, cookies, PWA shell entries, and server data are separate
resources; only the first two private-cache resources are touched here.

IndexedDB and OPFS are not atomic. Any failure leaves the durable purging
marker and the in-memory global suspension in place; callers must retry the
clear explicitly. A successful final commit is the only path that re-enables
new cache scopes.

# C1 explicit logout and verified account switching

Work in progress, candidate only. Native GET `/auth/logout` must remain a
server navigation, including Cloudflare Access redirects. Identity invalidation
is distinct from ordinary cache deletion: only the former may discard a live
authenticated editor buffer. Peer messages invalidate; `/api/me` authorizes.

## Candidate correction: cache-disabled verified online viewer

`/api/me` is the authority for the authenticated viewer. Cache inspection, cleanup,
and persistence are best-effort side effects: a storage failure returns the
verified user with `cacheViewerId: null` and an AppShell warning instead of
blocking online data. The candidate never treats a failed cleanup as completed,
does not probe or write an unknown prior identity, and relies on the cache
purge's suspension of each known prior identity when cleanup fails. Abort
signals and AppShell request generations remain authoritative.

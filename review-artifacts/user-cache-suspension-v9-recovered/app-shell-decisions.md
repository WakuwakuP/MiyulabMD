# D32 AppShell viewer-context candidate decisions

## Scope

This candidate connects the existing `resolveViewerContext` helper to the real
`AppShell` and publishes one viewer-owned context to the outlet and header.
The live application and the helper remain unchanged for parent review.

## Chosen design

- `AppShell` owns one `ViewerContext`; legacy `user`, `userLoading`, and
  `setUser` fields remain as compatibility projections.
- `/api/me` resolution and optional auth configuration resolve independently.
  Auth configuration retains the existing mock-friendly default on failure.
- The viewer request is abortable and publication is guarded by both effect
  lifetime and a generation token. Cancellation is consumed; unexpected
  resolver errors publish `unavailable` rather than inventing cached state.
- `setUser` invalidates the bootstrap request. A profile update for the same
  authenticated ID retains its current cache ownership; another ID receives no
  previous cache ownership, and `null` clears the association.

## Alternatives rejected

- `Promise.all(fetchMe(), fetchAuthConfig())`: an optional config failure can
  discard a valid viewer.
- A second mutable `user` state: it can diverge from cached/authenticated
  viewer mode.
- A broad bootstrap catch that manufactures cached mode: only the resolver
  knows when cached fallback is valid.
- Fire-and-forget persistence in `setUser`: ordered identity persistence
  belongs to the resolver.

## Status

Candidate only. Parent reviews the files, runs the candidate runner, and
chooses whether to adopt them.

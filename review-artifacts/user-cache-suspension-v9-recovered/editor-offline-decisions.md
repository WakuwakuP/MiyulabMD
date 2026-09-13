# D41 editor cached-note candidate decisions

## Recommended boundary

`EditorPage` owns one `createNoteReadSession(viewer)` and one
`viewing.beginView(viewer)` scope for the current note ID and shell viewer
identity. The scope is disposed only when that identity, ID, or component
changes, not when the read promise resolves. The reader remains the source of
truth for network/cache provenance and `cachedAt`.

The candidate deliberately keeps cached and fallback results read-only:
there is no task-note binding, collaboration session, access mutation, folder
mutation, or optimistic edit path. This avoids making a cached snapshot appear
editable and lets the existing mutation gate reject direct writes.

## Alternatives considered

* Continuing to call `loadNote`/`noteFromCaches` was rejected: those APIs have
  no owned viewer/session and cannot distinguish verified cache ownership from
  SSR or legacy maps.
* Disposing the viewing scope in the read continuation was rejected: header and
  task controls can outlive the promise, so the provenance must remain
  available for the entire display lifetime.
* Treating `viewer.user` as sufficient authentication was rejected: cached
  and unavailable viewer modes intentionally do not prove a current session.
* Keeping the normal collaborative editor active for cache fallback was
  rejected: it creates a write-capable transport for a read-only snapshot.

## Evidence

The two D41 real-page tests fail before this candidate because the legacy
`EditorPage` uses `loadNote` and never polls the persistent cache. The
candidate uses the approved session's `source` and `cachedAt` directly and
publishes the same result to the approved viewing controller.

## Rejected implementation

The first candidate version replaced the existing page with a small
read-only renderer. That approach is rejected: it removed the online editor,
Yjs collaborative lifecycle, mode switching, folder/access/history controls,
article-source handling, and the existing editor header behavior. Passing the
offline acceptance cases by deleting those capabilities violates D41's
requirement to preserve the online editing UX. The replacement must instead
start from the complete 656-line `EditorPage.tsx` and make only the owned-read,
provenance/capability, and cache-status changes.

## D42 adoption notes

The complete page now starts with no legacy cache/SSR note state. After
`userLoading` settles it creates a viewer-owned read session and a viewing
scope, and keeps both alive for the display lifetime. The result publishes
source and viewer association before it can update the page; stale results
are ignored. Cache results remain preview-only, suppress collaboration and
mutation-oriented header controls, and expose the persisted `cachedAt` value
in one accessible status message. A cache miss has a local-cache explanation,
while server failures retain their cache warning.

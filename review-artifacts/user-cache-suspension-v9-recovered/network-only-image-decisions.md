# Network-only preview image decisions

## Scope

This candidate adds `acquireAttachedImageNetworkOnly` without changing the
existing cache-backed acquisition path. Its in-flight namespace is separate
and keyed by the captured expected viewer (`null` for guest), so guest, Alice,
Bob, and cache-backed reads cannot share a transport.

The primitive validates the canonical same-origin attachment URL, calls
`apiFetch` with an explicit identity expectation, and accepts only a 2xx
response with PNG/JPEG/GIF/WebP MIME. It never opens offline storage, writes a
denial marker, performs recovery, or creates a Blob URL. Preview ownership
continues to revoke Blob URLs during cleanup and context changes.

## Deliberate compatibility

Cache-backed reads retain their existing `acquireAttachedImage` path and
foreground/background in-flight sharing, including `requireCache` behavior.
Only network-source previews use the new primitive. Unavailable or cached-only
viewer contexts fail closed; external images retain raw rendering.


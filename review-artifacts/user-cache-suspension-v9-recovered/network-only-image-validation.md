# Network-only preview image validation

## Evidence status

The browser spec is present at
`apps/web/tests/browser/network-only-preview-image.spec.ts`. The isolated
candidate worktree has no `node_modules`, so the browser runner, typecheck, and
lint could not be executed here. No GREEN result is claimed. The parent worker
should run the requested browser matrix and candidate regression suite with its
installed dependencies. `node --experimental-strip-types --check` passes for
the new spec.

## Required RED/GREEN matrix

- RED: guest plus a `user:alice` response must demonstrate the prior raw
  `<img>` display, without a fetch spy.
- GREEN: guest/`guest` and authenticated Alice/`user:alice` display through
  Blob URLs; wrong, missing, or malformed identities are hidden.
- GREEN: HTTP denial/status errors, unsupported or missing MIME, and redirects
  do not fall back to cache or raw source.
- GREEN: network-only runs show zero IndexedDB, OPFS, metadata-write, denial,
  and recovery activity.
- GREEN: unmount/context switch aborts transport and publishes no late result;
  created Blob URLs are revoked.
- GREEN: guest and Alice never share a transport; same-actor consumers share
  one request and only abort it when the final consumer leaves.
- GREEN: existing cache-enabled foreground/background quota sharing remains
  unchanged.

## Review follow-up

The prior candidate was not approved: it routed every network source through
network-only, used an `error.name` identity check, accepted empty image bodies,
left rejected response bodies undisposed, and left managed raw URLs visible
without an image context. This revision addresses those findings with explicit
acquisition modes, an `instanceof ApiIdentityError` check, best-effort body
disposal, empty-body rejection, and fail-closed managed-image resolution.
Parent evidence remains unchanged: the primitive browser check was 2/2, Biome
reported 20 errors, and candidate-wide typecheck was blocked by a known error
in another candidate folder. No full browser matrix, Biome, or candidate
typecheck was run in this isolated checkout because dependencies are absent.

## Remaining risk

The candidate source has not been executed in this isolated checkout. Browser
coverage and source/runtime compatibility therefore remain for the parent
worker to establish.

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

## Remaining risk

The candidate source has not been executed in this isolated checkout. Browser
coverage and source/runtime compatibility therefore remain for the parent
worker to establish.

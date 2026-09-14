# Pending cross-tab note-denial regression

Public two-page regression: `apps/web/tests/browser/note-denial-tabs.spec.ts`.
Page A holds an authenticated Alice note response. Page B receives same-actor
HTTP 403 and completes durable denial. Releasing A's older 200 currently returns
a successful note and restores its body in the shared cache.

Parent command:

```sh
node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser note-denial-tabs.spec.ts --workers=1
```

Actual **RED**: expected `{restored: null, stale: false}`, received the original
Markdown body and `stale: true`. Baseline cache SHA256:
`88abe30421cd1ebd586adf0020ffb36f424e656829ab5d1a117a4cf3b116115c`.

The existing note generation ledger is realm-local. Shared user-clear epochs
alone do not order individual note denial. Repair must preserve canonical/short
identity, same-page entry ordering, fail-closed marker writes, independent
resources, and genuinely fresh post-denial revalidation. Do not substitute
latest-request-wins or permanently sticky denial.

This test is deliberately committed failing until the core repair follows the
currently owned folder-denial slice. No test exclusion or completion claim.

# Device private-cache clear adoption manifest

This manifest adopts the device-wide private-cache clear
(`clearOfflineCacheDevice`) from the canonical candidate into the live tree.
The design rationale lives in `device-cache-clear-decisions.md`; the required
browser test plan lives in `device-cache-clear-validation.md`.

Decision: adopt the candidate `offline-cache.ts` wholesale. The candidate is
the current live file plus the device-clear change set only — it already
contains the mounted-folder denial adoption (live hash before adoption matches
the `mounted-folder-adoption-manifest.md` expected live hash), so a byte copy
with the candidate-only banner stripped introduces no unrelated delta. No
other live source file is changed by this adoption; every caller keeps the
same exported names, and the composed epoch remains an opaque
`string | null` to callers.

Scope deliberately excluded: the settings/device-clear UI (C10), prefetch,
editor, and worker integration. The browser specs `manual-cache-clear.spec.ts`
and `manual-cache-clear-tabs.spec.ts` are the acceptance gate and are tracked
with the live test suite, not this manifest.

| Candidate path | Live path | Candidate SHA-256 | Expected adopted live SHA-256 |
|---|---|---|---|
| `offline-cache.ts` | `apps/web/src/lib/offline-cache.ts` | `90ac8fd47a612177e30bfde1c05e3db0da293fa5a41694ca4e80c99e4a773b09` | `4499dcb2c6d47d17e4b8bf32505116336e1f0c46672c041815ea8e48aa270ad9` |

The flat `offline-cache.ts` candidate begins with one candidate-only comment:
`// Canonical candidate v9; see decisions.md for transaction-terminal rationale.`
That line is removed in the live file; the second hash in its row is the
comment-stripped candidate hash.

Before adoption, the live hash was
`cd0f9cfb9a9cd14ff1f910e00a2fa53c88530a71ef26c0fe91352c76b006df65`.
No unlisted live source is authorized by this manifest.

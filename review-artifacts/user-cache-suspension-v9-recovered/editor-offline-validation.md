# D41 editor cached-note validation

This record belongs to the candidate directory only. The live
`apps/web/src` tree and browser tests were not edited.

## Required commands

Run from the repository root after adopting the candidate:

```text
node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser offline-note-view.spec.ts
node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered all
pnpm --filter @miyulabmd/web test
git diff --check
```

Expected acceptance evidence is 2 passing D41 browser cases, the full
candidate runner's 38 browser cases plus typecheck and Biome, and 117 existing
live regression cases. The parent agent should record actual exits and
post-edit SHA-256 values here after running them, since this candidate is
intentionally not committed by this agent.

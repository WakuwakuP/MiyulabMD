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

## D41/D42 execution record

The requested candidate-only commands were run after the final edit:

* `pnpm install --frozen-lockfile` — exit 0 (dependencies were absent).
* `pnpm --filter @miyulabmd/web test:browser:install` — exit 0 (browser was
  absent and installation was required).
* `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser offline-note-view.spec.ts`
  — exit 0, 2 passed.
* `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered all`
  — exit 0, typecheck/Biome passed and 38 browser tests passed.
* `pnpm --filter @miyulabmd/web test` — exit 0, 117 existing tests passed.
* `git diff --check` — exit 0.

Final candidate `EditorPage.tsx` SHA-256:
`f408a950c643bb90a974685ae0bbc6167ac6e14491f6c92c61b1e6750533d266`.

The live editor source was not edited; the canonical live SHA remains
`6b17a840782b766d9520f0aae1f05c9bb78f3689e2d67bcdac1f707b0e13217c`.

## D43/D44 execution record

After the corrections above:

* `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered typecheck`
  — exit 0.
* `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser editor-read-lifecycle.spec.ts offline-note-view.spec.ts`
  — exit 0, 5 passed.
* `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered all`
  — exit 0, typecheck/Biome passed and 41 browser tests passed.

The focused runner initially needed the authorized dependency and browser
setup: `pnpm install --frozen-lockfile` and
`pnpm --filter @miyulabmd/web test:browser:install`, both exit 0. The
post-edit `EditorPage.tsx` candidate SHA-256 is
`04f23ebc46900b6a5b8a07cd295faf8a35451de5140d87e7c55b3d3343c722ee`.
* `pnpm --filter @miyulabmd/web test` — exit 0, 117 passed.
* `git diff --check` — exit 0.

The live editor source and live tests remain untouched.

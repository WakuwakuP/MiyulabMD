# D52 Home metadata validation

Candidate validation was run serially from HEAD `84b4ad6` (the candidate remains
under review and no live `apps/web/src` files were edited).

1. `pnpm install --frozen-lockfile` — exit 0 (625 packages installed; required
   because `vite` was initially absent).
2. `pnpm --filter @miyulabmd/web test:browser:install` — exit 0.
3. `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser offline-drive-view.spec.ts` — exit 0,
   6/6 passed.
4. `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered all` — exit 0,
   52/52 browser tests passed; candidate typecheck and Biome checks passed.
5. `pnpm --filter @miyulabmd/web test` — exit 0, 117/117 passed (live
   regression suite, not candidate unit proof).
6. `git diff --check` — run after this record is appended.

The initial browser command before installing Chromium exited 1 solely because
the Playwright executable was missing; it was not treated as a product failure.
The first post-install run was 5/6 because guest controls were hidden while the
public root was pending; the header ownership gate was corrected and the final
run is 6/6.

Candidate SHA-256 values from the final all-check run:

- `api.ts`: `3e7cdbde8d16e9f5bd70f4b214a01294829bf4fd0db131330e91e3902c241534`
- `offline-cache.ts`: `9b4835fb13e8b7aa209a5561e84f34a14b42e7e7a0b3912ebf041eeacade9b15`
- `src/lib/home-metadata-reader.ts`: `5efb0348f58ec36c0d49301ec34db77f54055709103501aaa7f6dd36e5da7c82`
- `src/pages/HomePage.tsx`: `93ccda2eed170b05238d2994bb0a0549019fe9400a63f019ee0e395de77b5d2e`

The candidate browser runner also reported the expected RED-to-green behavior:
online authenticated root and child snapshots were saved, and the offline
reload displayed the cached child and canonical root data without folder/note
API reads.

## D53 viewer-lifetime validation

Validation is recorded after the candidate-only change. Commands are run
serially from the repository root; exit codes and result counts are retained
here, along with the candidate hash.

### Commands and results

- `pnpm install --frozen-lockfile` — exit `0`; dependencies installed.
- `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser home-metadata.spec.ts offline-drive-view.spec.ts` — first run exit `1` because the Playwright Chromium executable was not installed; no test cases ran.
- `pnpm --filter @miyulabmd/web test:browser:install` — exit `0`; Chromium and required browser support packages installed.
- `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser home-metadata.spec.ts offline-drive-view.spec.ts` — exit `0`; `7 passed`, `0 failed` in `8.4s`.
- `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered all` — exit `0`; candidate check covered `16 files`, then `53 passed`, `0 failed` in `14.1s`.
- `pnpm --filter @miyulabmd/web test` — exit `0`; `117 passed`, `0 failed`, `0 skipped`.
- `git diff --check` — exit `0`.

Candidate `src/pages/HomePage.tsx` SHA256 after validation:
`6ed55396207a23917eb39fa70a801acee70a94b9f5ee4b2b93da9cbd143d8f51`.

The live `apps/web/src` tree has no diff (`git diff --quiet -- apps/web/src`
exit `0`). Only the allowed candidate Home file and the two allowed metadata
records are modified.

Final post-record verification: `git diff --check` exit `0`, live
`apps/web/src` diff check exit `0`, and the candidate Home SHA256 remained
`6ed55396207a23917eb39fa70a801acee70a94b9f5ee4b2b93da9cbd143d8f51`.

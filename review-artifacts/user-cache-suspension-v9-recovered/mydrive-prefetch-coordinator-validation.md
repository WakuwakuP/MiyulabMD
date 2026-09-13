# MyDrive prefetch coordinator validation

This document records D85 validation for the candidate worktree. The change is
limited to the new coordinator, the candidate `AppShell` attachment, and these
two candidate records. Acquisition (`mydrive-prefetch.ts`), APIs, storage, PWA,
other UI, tests, runners, and live sources are unchanged.

The focused trigger cases are:

- startup failure followed by three `online` events;
- startup failure followed by three visible `visibilitychange` events;
- one recovery cycle and one body fetch after each burst, without reloading
  Home.

Validation commands and exact results are appended after the serial run. This
slice does not claim full prefetch, offline/PWA, auth-refresh, periodic,
mutation, focus, cross-tab, or normal-request coalescing completion.

## D85 serial validation

- Candidate focused browser:
  `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser tests/browser/mydrive-prefetch-triggers.spec.ts mydrive-prefetch.spec.ts`
  — **3 passed**. This includes both recovery bursts and the existing startup
  MyDrive acquisition case.
- Candidate complete suite:
  `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered all --workers=1`
  — **76 passed**, including typecheck and Biome.
- Live unit regression:
  `pnpm --filter @miyulabmd/web test` — **117 passed, 0 failed**.
- `git diff --check` — passed.
- Dependencies were initially absent; the permitted
  `pnpm install --frozen-lockfile` and project-local
  `pnpm --filter @miyulabmd/web run test:browser:install` were run before
  validation. No source, test, runner, API, storage, or PWA files were added
  outside the requested candidate scope.

Final SHA-256 values:

- `src/lib/mydrive-prefetch-coordinator.ts`:
  `66d69d81e75611e10eede709aa1314a942ec44c9a718a2858087f54226eee177`
- `src/components/layout/AppShell.tsx`:
  `4a2cc87657ec28228477ffb452412b31815e00f6540e93b25651c6dc7b2471e8`
- `mydrive-prefetch-coordinator-decisions.md`:
  `1d2f5cc6b026349fac5fbe07014760ae07bbd9dadaa09e04d6edb846a14818de`

## D88 serial validation

- Initial dependency setup:
  `pnpm install --frozen-lockfile` — **completed**.
- Project-local browser setup:
  `pnpm --filter @miyulabmd/web run test:browser:install` — **completed**.
- Candidate focused browser:
  `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser tests/browser/mydrive-prefetch-tabs.spec.ts mydrive-prefetch-triggers.spec.ts mydrive-prefetch.spec.ts`
  — **5 passed**.
- Candidate complete suite:
  `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered all --workers=1`
  — **78 passed**, including candidate Biome checks.
- Live unit regression:
  `pnpm --filter @miyulabmd/web test` — **117 passed, 0 failed**.
- `git diff --check` — **passed**.
- Candidate source SHA-256:
  `src/lib/mydrive-prefetch-coordinator.ts`:
  `83860f35d2da2d6d745d6042ba0a148e9dbfaf1fcc8bac1c0008659bd8d3b44c`.
- Scope check: only the candidate coordinator source and the two append-only
  coordinator records were changed. No live source, tests, runner, API,
  storage, AppShell, or PWA files were edited.
- This validates D88 only; it does not claim full PWA completion or the
  explicitly deferred identity-change/privacy and deduplication requirements.

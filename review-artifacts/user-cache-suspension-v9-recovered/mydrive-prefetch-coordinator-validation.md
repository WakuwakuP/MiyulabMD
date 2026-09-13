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

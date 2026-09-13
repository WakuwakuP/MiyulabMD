# MyDrive prefetch candidate validation

The RED test is `tests/browser/mydrive-prefetch.spec.ts`: authenticated Home
must remain rendered while an unvisited owned folder and owned note body become
available through the existing cache APIs; an accessible note owned by another
user must not be fetched. The same test then disables API traffic and navigates
to the cached folder and note.

Validation performed in this candidate worktree:

- `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser tests/browser/mydrive-prefetch.spec.ts`: 1 passed.
- The same runner in `all` mode with the 66 positional files from
  `apps/web/tests/browser/*.spec.ts`: typecheck passed, Biome passed, 66 passed.
- `pnpm --filter @miyulabmd/web test`: 117 passed.
- `git diff --check` and focused Biome check: passed.

Candidate SHA-256 values:

- `src/lib/mydrive-prefetch.ts`: `a13c8bc96503fff89ba33f1fe99903d134df068172e67cd4c5ce375855f1fa95`
- `src/components/layout/AppShell.tsx`: `3de2893f6ffc6f1afa962870d74a98a44828b8df7bae212e78eca822a5055e42`
- `api.ts`: `2edc2e4ecf6a15a2eb5261d7fd24cffc279943f3d4f13377dd0bd0f26306d08e`

This deliberately does not claim live adoption, full offline coverage, retries,
cross-tab coordination, images, or quota recovery. The parent should rerun the
combined suite when the two D76 lifecycle cases are present.

## D77 validation

- Candidate focused browser command
  `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser mydrive-prefetch-ownership.spec.ts mydrive-prefetch.spec.ts`:
  first attempt failed before tests ran because the worktree-local Chromium
  executable was missing; after the allowed local install, 2 passed.
- Candidate all command
  `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered all`:
  the default list includes ownership and cached lifecycle2 coverage; 69
  passed, 0 failed, including typecheck and Biome checks.
- Parent baseline before this fix remains 67 passed / 1 failed (68 total);
  the focused Home root-link failure passed on five one-worker repeats, so it
  remains an unresolved intermittent failure rather than being called green.
- Live web unit command `pnpm --filter @miyulabmd/web test`: 117 passed,
  0 failed.
- `git diff --check`: passed.

# Mounted folder denial validation

RED was attempted with:

```text
node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser mounted-folder-denial.spec.ts --workers=1
```

The first executable check in this checkout was also RED before the
implementation pass: `pnpm exec tsc --noEmit --pretty false` exited 1 because
the checkout has no installed `tsc`/workspace dependencies (`tsc` was not
found). This is an environment/compile blocker, not evidence of browser
GREEN.

The runner could not start in this checkout because the candidate runtime
dependencies (notably `vite`) are not installed. Browser GREEN and candidate
typecheck/lint counts remain unverified and must be run in the prepared
candidate environment.

Static validation completed:

```text
git diff --check: passed
live apps/web/src/**: unchanged
```

The new browser spec is present at `apps/web/tests/browser/mounted-folder-denial.spec.ts`;
it was not executable in this checkout for the dependency reason above.

Parent's prepared candidate run measured 12/14 before this change. The two
failures were the delayed old-denial ordering fence and the transaction receipt
returning `epoch: null` instead of the uninitialized cache scope's opaque
`"0"`. The receipt now takes the epoch default inside the same IDB transaction.

The six former cache-only “UI” cases were removed rather than counted as
successes. They did not mount Home/CachedDrive, did not await lifecycle
delivery, did not inject storage failure, or did not hold an HTTP response.
They must be replaced by real route fixtures in the prepared browser run; this
slice does not claim those cases are GREEN.

## Parent verification correction

The previous validation claim was not a passing implementation result. Parent
verification found candidate typecheck RED (`offline-cache.ts` had an
unreachable `action === "check"` branch), candidate lint RED (8 errors and 2
warnings, including lifecycle and Home metadata complexity), and only one
browser case GREEN. That browser case was a false positive: it awaited
`denyFolder(oldRead)` before `putFolder(newRead)` and therefore did not hold the
old denial across the newer successful write. The follow-up spec contains
independent race, authority, lifecycle, projection, and page-lifetime cases;
the prepared candidate dependencies are still required to execute them.

## 51acba5 / ae8075a migration record

The useful folder signal/owner changes from `51acba50bd8109f5a3c00fb38a14cb26196c176e`
were migrated only into the four candidate sources and this artifact record.
The live tree was not edited; `ae8075a` remains the live revert/verification
state. The migration also removes the existing candidate complexity violations
by extracting lifecycle, note-list, and Home snapshot helpers. No browser DOM
or full candidate typecheck/lint run was executed because dependencies are not
installed. `git diff --check` passed and `git diff -- apps/web/src --exit-code`
reports no live working-tree changes.

## Parent prepared candidate measurements

The parent prepared candidate run recorded:

```text
candidate typecheck: PASS
folder authority focused tests: 11/11 PASS
full candidate lint before this cleanup: 7 errors, 2 warnings
```

This worker only edits the candidate sources and this validation artifact; DOM
tests remain reserved for the next slice.

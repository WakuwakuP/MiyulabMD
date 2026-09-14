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

# Mounted folder denial validation

RED was attempted with:

```text
node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser mounted-folder-denial.spec.ts --workers=1
```

The runner could not start in this checkout because the candidate runtime
dependencies (notably `vite`) are not installed. Browser GREEN and candidate
typecheck/lint counts remain unverified and must be run in the prepared
candidate environment.

Static validation completed:

```text
git diff --check: passed
live apps/web/src/**: unchanged
```

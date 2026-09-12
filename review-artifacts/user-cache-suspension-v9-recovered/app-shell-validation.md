# D32 AppShell viewer-context candidate validation

## Final run record

- `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser app-shell-viewer.spec.ts`
  exited `0`: `1 passed`.
- `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered all`
  exited `0`: candidate lint/typecheck and `33 passed`.
- `pnpm --filter @miyulabmd/web test` exited `0`: `117 passed`.
- `git diff --check` exited `0`.

The first runner attempts were blocked by missing dependencies and then by the
Playwright browser executable; locked dependency installation and the
authorized `pnpm --filter @miyulabmd/web test:browser:install` resolved those
environment issues. A concurrent `all` attempt also hit a temporary Vite port
collision; the serial rerun above passed.

## Final candidate file hashes

- `src/components/layout/AppShell.tsx`: `2211578ab5cd6dc9226c0b9a8c06157a95d6fae03f9392dd95c65802c1b92f0a`
- `src/components/layout/AppShellContext.ts`:
  `0ff5b9d61b118865cde5859b5557eab56c21e76eeafdf2d3d680e47d78de2915`

## Status

Candidate implementation complete; parent review and adoption remain pending.

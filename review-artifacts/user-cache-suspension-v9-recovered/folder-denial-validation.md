# D60 folder denial validation

The candidate-only primitive was validated serially with the requested
commands:

```text
pnpm install --frozen-lockfile                         exit 0
pnpm --filter @miyulabmd/web test:browser:install     exit 0
candidate browser (denial + folder cache):             exit 0, 5 passed
candidate all:                                         exit 0, 61 passed
pnpm --filter @miyulabmd/web test                     exit 0, 117 passed
git diff --check                                       exit 0
```

The first `all` run had one unrelated flaky `app-shell-viewer.spec.ts` failure
(60 passed, exit 1); its serial rerun passed all 61 tests.

Final SHA256:

```text
offline-cache.ts            428673176c94a17fc16f1600c0516e85af5be5a89e7a6b0de1023e3551ff9591
folder-denial-decisions.md  9a6502c41cd125ffba578517f6ca64144a184cbb3dc41e32974b9199e8301edb
folder-denial-validation.md 252b8f36d35297a3c035b648d9de9181ad66402ca6001d74f8b9498d9c0a524c
```

The live `apps/web/src` tree is unchanged by this slice.

## D62 nearest visible parent validation

Commands were run serially for checkpoint `dd5d526`:

```text
pnpm install --frozen-lockfile                         exit 0, 855 packages
pnpm --filter @miyulabmd/web test:browser:install     exit 0
focused candidate browser (6 tests):                  exit 0, 6 passed
candidate all:                                         exit 0, 62 passed
pnpm --filter @miyulabmd/web test                     exit 0, 117 passed
git diff --check                                       exit 0
```

The focused candidate command first exited 1 because Chromium was not
installed. The first `all` command exited 1 on the expected TypeScript
`noUncheckedIndexedAccess` diagnostic before the `.at(-2)` lint-compatible
correction; the final rerun above passed. No test or runner files were changed.

Final SHA-256 before this append:

```text
candidate review-artifacts/user-cache-suspension-v9-recovered/offline-cache.ts
7ea33268a699c8ea16550164e5ac806c32a7b10a7b6a2d18b95b2ea57f54fcff
live apps/web/src/lib/offline-cache.ts
64d56a1e0570116fe90d4613635ab262947922873a7cb8240254e82846ebbbd9
```

The live `apps/web/src` tree remains unchanged. Only the permitted candidate
`offline-cache.ts` and these two append-only review records were modified.

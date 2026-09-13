# D47 validation

The RED browser test was run through the candidate runner after installing the
worktree Chromium browser.

- `browser offline-drive-view.spec.ts`: **1 passed**, exit **0**
- `all`: browser passed, but candidate lint exited **1** on formatting/style
  diagnostics; no fixes were applied by the runner.
- Live application tests were not run in this slice.

The browser runner verified the candidate without modifying candidate or live
source files. The candidate runner's SHA-256 lines are retained in the
validation transcript. Remaining limitation: this candidate is a focused
cached-view implementation and needs the normal online HomePage behavior
merged around it before adoption.

## D48 repair

The repair files are being staged as candidate-only sources. Validation of the
new reader and cached view is pending completion of the full HomePage candidate
replacement; D47's browser result must not be treated as D48 evidence.

## D48 validation

The candidate was repaired in place with the complete network HomePage baseline
preserved. Validation commands and their exact exits are recorded below after
the implementation:

- `browser offline-drive-view.spec.ts`: exit **0**, **3 passed**
- `all`: exit **0**, **47 passed**
- live web unit suite: exit **0**, **117 passed**
- `git diff --check`: exit **0**

The candidate runner reported no Biome diagnostics and successful typecheck. It
did not write candidate or live source files. The live `apps/web/src` tree was
checked separately and remains unchanged; final SHA-256 values are reported by
the implementing agent alongside this record.

## D49 validation

Commands were run serially from parent checkpoint `910d755`:

- `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser offline-drive-view.spec.ts`
  initially exited **1** because dependencies were absent.
- `pnpm install --frozen-lockfile` exited **0**; packages installed: **625**.
- The same browser command exited **1** before browser installation because
  Playwright's Chromium headless executable was absent.
- `pnpm --filter @miyulabmd/web test:browser:install` exited **0**.
- The browser command then exited **0**: **4 passed**.
- `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered all`
  exited **0**: **48 passed**; candidate typecheck and Biome checks passed
  (`Checked 15 files ... No fixes applied.`).
- `pnpm --filter @miyulabmd/web test` exited **0**: **117 passed**, **0 failed**.
- `git diff --check` exited **0**.

The focused suspension regression passed, including the native IndexedDB
ordering where the folder transaction completes before the list callback and
the user is suspended in between. Candidate SHA-256 changes relative to
`910d755` were:

| File | `910d755` | after D49 code edit |
| --- | --- | --- |
| `src/lib/cached-drive-reader.ts` | `a6ad7f588d71bc5666328a5e7ff468ecc8a5139f5c0aa553676aa756ac9fc326` | `2248e1ada26df30abe3bd42736c67c02c74131eb540cc6e93982497718312da1` |
| `src/pages/HomePage.tsx` | `3ac8f75645c2a1df94d6220a489423f1fbe95007c93ce3ba672a16baedfa9d33` | `4afdca6bd28aa7f3adf6cb77eca3460785923f97e7336090eebbbd5a121acd72` |

The two dedicated records were unchanged before this append; their
post-append hashes are recorded by the parent review after this entry is
written. No live source files were adopted or modified.

# D101 候補検証

## 実施予定／結果

- `note-request-sharing.spec.ts`：背景の保留中 GET と keyboard navigation の
  Editor read が同じ authenticated viewer scope の進行中 request を共有し、
  HTTP note GET が 1 回、通常の network body／Edit が成立することを確認する。
- `note-read-session.spec.ts`：authenticated viewer の captured user ID だけを
  helper に渡し、cached viewer は渡さないことを確認する。
- `mydrive-prefetch.spec.ts`：prefetch が開始時に捕捉した user ID を helper に
  渡すことを確認する。
- 候補全体：`check-offline-candidate.mjs ... all`（期待 86 件）。
- live unit：117 件（候補 runner の対象外）。
- Biome／diffcheck：候補ファイルと許可された scope のみを確認する。

親の採用前に subscriber 単独中断、全員中断、結果値の独立性、settled cleanup
の追加テストを行う。これは最初の D101 slice であり、folder/list、legacy hover、
cross-tab HTTP sharing の完了を意味しない。

## D103 検証

- 対象変更：`src/lib/note-request.ts` のみ。失敗結果 container を subscriber
  ごとに複製し、成功値のコピー例外を該当 subscriber の reject として処理した。
- `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser note-request-subscribers.spec.ts note-request-sharing.spec.ts note-denial-entry-ordering.spec.ts note-denial-ordering.spec.ts --workers=1`
  は 8 passed、0 failed。候補 `src/lib/note-request.ts` の SHA-256 は
  `98e595229a40ef5a20376b86bbb972ee6d85133e01dbac6664106c7254f005e3`。
- 候補全体は `check-offline-candidate.mjs ... all` で 90 件、live unit は 117 件を
  期待値とする。Biome／diffcheck は許可された候補 scope のみを対象にする。
- `node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered all`
  は candidate 20 files checked、90 passed、0 failed。`pnpm --filter
  @miyulabmd/web test` は 117 passed、0 failed。`pnpm exec biome check
  review-artifacts/user-cache-suspension-v9-recovered/src/lib/note-request.ts
  review-artifacts/user-cache-suspension-v9-recovered/note-request-decisions.md
  review-artifacts/user-cache-suspension-v9-recovered/note-request-validation.md`
  は 1 file checked、問題なし。`git diff --check` も成功した。
- この候補結果は親の独立レビューと採用判断を要する。ライブ採用および全体の
  request coalescing 完了を意味しない。

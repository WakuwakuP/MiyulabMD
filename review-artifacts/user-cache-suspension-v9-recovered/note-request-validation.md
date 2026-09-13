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

# 回収したv9の親検証

## 完全bytesの確認

子worktreeの原典と、編集ツール経由で回収したファイルのハッシュが一致した。

```text
offline-cache.ts     515a9c378f86e65e6def3427074c32a423743d0058ffd1099ae8047637958fcd
note-read-session.ts 081bb2dbd02aedecf096b7f6cec7cfde13979a64e0cc2c00c23c1c363da260b7
```

## 親が回収後に実行した検証

```text
node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered all
exit 1
candidate typecheck: passed
candidate Biome: passed
browser: 29 passed, 1 failed
```

既存29件はすべて成功し、native IDB未確定／complete境界の2件も成功した。
失敗は追加した `note-denial-entry-ordering.spec.ts` の1件。
DB接続失敗を伴う403の後でも、先行した200が成功を返してしまい、
`oldPublished=false` の期待に対しtrueとなる。

**本候補は未採用。** D26の後継修正と再検証が必要。
ライブの `apps/web/src/` はこの検証で変更していない。

## 元担当の報告（親の再実行とは区別）

- frozen install、専用Chromium install：exit0。
- 当時の既定29ブラウザ、候補型チェック・Biome：exit0。
- 単独の書き込みライフサイクル2件は成功したが、旧ランナーの不要な
  セッションmodule読込要求によりコマンド全体はexit1。ランナーはD24で修正済み。
- 既存ライブWeb unit：117 passed、exit0。
- cached diff-check：exit0。

当時の29件成功を、現在の追加テストを含む30件成功とは扱わない。

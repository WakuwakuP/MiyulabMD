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

## D26修正後の検証

依存関係が未配置だったため、認可された frozen install を先に実行した。
Chromiumも指定されたWebパッケージのinstallコマンドだけで導入した。

```text
pnpm install --frozen-lockfile
exit 0
pnpm --filter @miyulabmd/web test:browser:install
exit 0
node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered browser note-denial-entry-ordering.spec.ts
exit 0
1 passed
node apps/web/scripts/check-offline-candidate.mjs review-artifacts/user-cache-suspension-v9-recovered all
exit 0
candidate typecheck: passed
candidate Biome: passed
browser: 30 passed
git diff --check
exit 0
```

`all` の30件には既存29件と `note-denial-entry-ordering.spec.ts` を含む。
`pnpm --filter @miyulabmd/web test` はこの担当では再実行していないため、既存ライブ
Webの過去の根拠（117 passed、exit 0）とは区別する。

最終候補ファイルのSHA256（この記録追記後のコードファイル）:

```text
note-read-session.ts 8bc7b324065c126fc8590b1a1b2e8babbdff159add0e23329079e65d83fe5d73
offline-cache.ts    4a1f88f52bca0ab86f2d54b1f2f0398430e68367ed7189248fb445f61e94db4e
```

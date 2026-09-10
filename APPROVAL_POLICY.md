# 承認ポリシー

全リポジトリ共通の指示は Automations の Custom Prompt（[貼り付け用](docs/approval-agent-custom-prompt.md)）。このファイルは同じ内容のリポジトリ側上書きである。

Cursor Bugbot は必須の承認シグナルである。欠落扱いでスキップしてはならない。

## 8 分ポーリング上限は使わない

既定プロンプトの「30 秒ポーリング、最大 8 分、超過したら承認しない」は、このリポジトリでは無効である。8 分はプラットフォームの実行上限ではなく、1 ターン内のポーリング天井にすぎない。Bugbot はそれより長くかかることがある。

- 「8 分超過」「polling timeout」を理由に承認も拒否も確定しない
- sleep や 30 秒ポーリングで 8 分を埋めない
- 未完了なら購読してターンを終える。アイドル待ちは 8 分に入らない。起床は別ターンである

## Bugbot 待ち

対象は **現在の HEAD SHA** の GitHub check `Cursor Bugbot` だけである。旧コミットの結果では現 HEAD を承認しない。

1. 初回の `gh pr checks` で未検出でも、まだ起動していないだけとみなす。スキップしない。
2. 未検出、または `pending` / `queued` / `in_progress` のときは次を行い、ターンを終える。
   - `subscribe_github_ci` を PR の head ブランチへ
   - `subscribe_github_pr` を当該 PR へ（Bugbot / cursor[bot] のコメント用）
   - `subscribe_timer`（5 分後、`once: true`）。起床時も未完了なら再購読して再びターンを終える
3. 新しいコミットでキャンセルされた実行は完了ではない。新 HEAD の `Cursor Bugbot` を待つ。
4. 結論の意味:
   - `success` → 指摘なし。コメントが無くてもよい。
   - `neutral` → 指摘あり、またはキャンセル、または内部エラー。承認しない。
   - `failure` / Bugbot 自体のキャンセル → 承認しない。このオートメーションの先行承認があれば `DISMISS_APPROVAL`。
5. 承認してよいのは、現 HEAD の `Cursor Bugbot` が `success` で、リスクが low のときだけである。

タイマー起床で Bugbot がまだ無い・まだ走っているときは、同じ購読を張り直してターンを終える。既定の 8 分を使い切って終了してはならない。

## 禁止

- 初回ポーリング未検出を「実行していない」とみなして承認すること
- 旧 SHA の Bugbot 結果で現 HEAD を承認すること
- `neutral` を pass とみなすこと
- 8 分間の sleep ループ
- 「8 分超過」を理由にこのランを終えること

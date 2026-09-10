# 承認ポリシー

Cursor Bugbot は必須の承認シグナルである。欠落扱いでスキップしてはならない。

## Bugbot 待ち

対象は **現在の HEAD SHA** の GitHub check `Cursor Bugbot` だけである。旧コミットの結果では現 HEAD を承認しない。

1. 初回の `gh pr checks` で未検出でも、まだ起動していないだけとみなす。スキップしない。
2. 未検出、または `pending` / `queued` / `in_progress` のときは、sleep や 30 秒ポーリングでターンを埋めない。
   - `subscribe_github_ci` を PR の head ブランチへ
   - `subscribe_github_pr` を当該 PR へ（Bugbot / cursor[bot] のコメント用）
   - 保険として `subscribe_timer`（数分後に再確認、`once: true`）
   - 購読したら「現 HEAD の Cursor Bugbot 完了待ち」と書いてターンを終える
3. 新しいコミットでキャンセルされた実行は完了ではない。新 HEAD の `Cursor Bugbot` を待つ。
4. 結論の意味:
   - `success` → 指摘なし。コメントが無くてもよい。
   - `neutral` → 指摘あり、またはキャンセル、または内部エラー。承認しない。
   - `failure` / cancelled / タイムアウト → 承認しない。このオートメーションの先行承認があれば `DISMISS_APPROVAL`。
5. 承認してよいのは、現 HEAD の `Cursor Bugbot` が `success` で、リスクが low のときだけである。

## 禁止

- 初回ポーリング未検出を「実行していない」とみなして承認すること
- 旧 SHA の Bugbot 結果で現 HEAD を承認すること
- `neutral` を pass とみなすこと
- 8 分間の sleep ループ

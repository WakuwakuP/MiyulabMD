# Approval Agent Custom Prompt

Pull Request Approver の Custom Prompt に、次のブロックをそのまま貼る。オートメーションが対象にしている全リポジトリに効く。リポジトリごとの `APPROVAL_POLICY.md` は不要（置くとこちらより優先される）。

既存の「pass ならコメント無しでもよい」「日本語で出力」は次に含めているので、古い Custom Prompt は置き換える。

## トリガー

トリガーの付け外しだけでは Bugbot 待ちは代替できない。Approval Agent が使えるのは次だけである。

- PR opened
- PR pushed / updated
- PR commented（正規表現）

`CI completed` や遅延は、汎用 Automations にはあるが Approval Agent には無い。opened / pushed を外してコメントだけにすると、指摘なし（コメント無しの `success`）の PR では起動しなくなる。

残す:

- PR opened
- PR pushed / updated（新 HEAD の再評価に必要）

任意で足す（待ちの代わりではなく、再実行用）:

- PR commented。例: `bugbot run|cursor review|BUGBOT_REVIEW`

起動後の待ちは Custom Prompt（購読してターンを終える）で行う。


```
日本語で出力してください。

Cursor Bugbot は必須の承認シグナルである。既定プロンプトの「初回ポーリングで未検出ならスキップ」「30秒ポーリング・最大8分・超過したら承認しない」はこの指示では無効である。

対象は現在の HEAD SHA の GitHub check「Cursor Bugbot」だけである。旧 SHA の結果では現 HEAD を承認しない。新しいコミットでキャンセルされた実行は完了ではない。新 HEAD の実行を待つ。

初回の gh pr checks で未検出でもスキップしない。まだ起動していないだけとみなす。未検出、または pending / queued / in_progress のときは、sleep や 30 秒ポーリングでターンを埋めない。subscribe_github_ci を PR の head ブランチへ、subscribe_github_pr を当該 PR へ、subscribe_timer（5分後・once: true）を張り、「現 HEAD の Cursor Bugbot 完了待ち」と書いてターンを終える。アイドル待ちは 8 分に入らない。起床は別ターンである。「8分超過」を理由に承認も拒否も確定しない。タイマー起床でも未完了なら、同じ購読を張り直して再びターンを終える。

結論の意味:
- success → 指摘なし。コメントが無くてもよい。
- neutral → 指摘あり、またはキャンセル、または内部エラー。承認しない。
- failure / Bugbot 自体のキャンセル → 承認しない。このオートメーションの先行承認があれば DISMISS_APPROVAL。

承認してよいのは、現 HEAD の Cursor Bugbot が success で、リスクが設定された最大承認閾値以下のときだけである。
```

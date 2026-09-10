# Approval Agent Custom Prompt

Pull Request Approver の Custom Prompt に、次のブロックをそのまま貼る。オートメーションが対象にしている全リポジトリに効く。リポジトリごとの `APPROVAL_POLICY.md` は不要（置くとこちらより優先される）。

既存の「pass ならコメント無しでもよい」「日本語で出力」は次に含めているので、古い Custom Prompt は置き換える。

## トリガー

Checks completed は「全部終わるまで待ってから1回」ではない。GitHub の check が **1つ終わるたび** に発火する（`lint-and-format` でも `Cursor Bugbot` でも、Approval Agent 自身の check でも）。

### Checks completed だけにすると

- `lint-and-format` が先に終わるので、Bugbot 未登録のまま起動する（今と同じ競合）
- Approval Agent 自身の check `Cursor Approval Agent: Pull Request Approver` 完了でも再起動し、ループしうる
- `by Me` は check を報告した bot と照合するので、Bugbot（`cursor[bot]`）では黙って落ちる。`by Anyone` にする
- Cursor エージェントが作った / push した PR では、Checks completed が黙って発火しない既知の制限がある

check 名を `Cursor Bugbot` に絞れるなら、opened / pushed を外してこれだけにするのはあり。そのときは Custom Prompt の待ちより「現 HEAD の Bugbot が `success` でなければ何もしない」が本体になる。絞れないなら足さない。

### 残す

- PR opened
- PR pushed / updated（新 HEAD の再評価。エージェント作の PR でも動く）

任意:

- PR commented。例: `bugbot run|cursor review|BUGBOT_REVIEW`
- Checks completed は **check 名 `Cursor Bugbot` に絞れるときだけ**。On Any Completion / On PRs / by Anyone。opened / pushed と重ねると lint 完了のたびに余分なランが走る

起動後の待ちは Custom Prompt（購読してターンを終える）で行う。Checks completed に絞れない限り、トリガーだけでは 8 分問題も初回スキップも消えない。


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

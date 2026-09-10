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

現 HEAD の GitHub check「Cursor Bugbot」の結果が返るまで承認しない。未検出・pending でもスキップしない。結果が無ければ待つ。

待つときは sleep や 30 秒ポーリングでターンを埋めない。subscribe_github_ci（PR の head ブランチ）、subscribe_github_pr（当該 PR）、subscribe_timer（5分後・once）を張り、ターンを終える。既定の「8分で止め」は無効。起床時も未完了なら同じ待ちを繰り返す。

success → コメント無しでも指摘なしとしてよい。neutral / failure / キャンセル → 承認しない。承認は Bugbot が success かつリスクが閾値以下のときだけ。
```

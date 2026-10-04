# MCP の処理時間と CPU 使用量

MCP の無料枠判定には、リクエスト全体の **CPU 時間** を使う。ツールの通信待ちを含む所要時間とは分けて見る。

## 計測

`apps/worker/wrangler.toml` で Workers Logs と Invocation Logs を有効にしている。`head_sampling_rate = 1` は全リクエストを収集する設定で、反映にはデプロイが必要。

各ツールのコールバックは `withToolTiming` で囲み、成功・ツールエラー・例外のいずれでも次の構造化ログを 1 件出す。

```json
{
  "durationMs": 125,
  "event": "mcp_tool_timing",
  "outcome": "ok",
  "tool": "get_note"
}
```

| 値 | 意味 |
| --- | --- |
| `durationMs` | ツールのコールバック開始から終了までの経過時間。D1 / R2 / DO / fetch の待ち時間を含む |
| `outcome` | `ok` / `tool_error`（`isError`）/ `exception` |
| Invocation Log の CPU time | 認証・サーバー作成・入力検証・ツール実行・レスポンス処理を含む、当該 Worker の CPU 時間。通信待ちは含まない |

Workers の時計はセキュリティ上 I/O のタイミングで進むため、`durationMs` は所要時間の目安になる。I/O を挟まない処理では 0 になる場合があり、関数の CPU 時間の精密な計測には使えない。CPU を使う箇所の内訳はローカルの DevTools CPU profiler で調べ、本番の制限判定は Invocation Log を使う。

引数・ノート本文・戻り値・トークン・ユーザー情報・例外の内容はタイミングイベントに記録しない。SDK がコールバック前に拒否する不正な引数・未登録ツール、および `initialize` / `tools/list` はツールイベントが出ず、Invocation Log で確認する。DO や別 Worker の CPU は、そのサービスの計測を別途確認する。

Cloudflare ダッシュボードで **Workers & Pages → miyulabmd → Observability** を開く。

1. `event = mcp_tool_timing` を絞り、`tool` ごとの件数・`durationMs` の中央値 / P95 を調べる。
2. `/mcp` の Invocation Logs を絞り、CPU time が 10 ms を超える呼び出しの件数・割合と、CPU 時間の分位点を調べる。
3. 該当する invocation の関連ログを開く（request ID で対応づける）と、ツール名と所要時間が分かる。CPU とツールイベントは別のログ行なので、両条件を同じ行に掛けない。

Workers Free の HTTP CPU 制限は 1 リクエスト 10 ms。代表的な読み取り・更新・大きな本文・ツール一覧を、初回と継続利用の両方で確認する。平均値や Paid でのエラー 0 件だけでは無料枠内と判定できない。ログ保存の上限・保持期間や sampling により未収集の呼び出しがないかも確認する。

## 共通処理の削減

`createMcpServerFactory` はリクエストごとに新しいサーバーを作る。認証コンテキスト、サービス、ユーザーの機能設定はリクエストごとに評価する。

固定のツール説明と Zod スキーマは `tool-definitions.ts` に置く。`toolInputSchema` は実際の Zod 検証を使いながら、SDK v2 が登録時と `tools/list` で要求する draft-2020-12 の入力 JSON Schema をモジュール初期化時に作って再利用する。キャッシュした JSON は再帰的に freeze し、別の dialect / `libraryOptions` は元の Zod に委譲する。

認証のトークン照合と `last_used_at` 更新は D1 の `batch()` で 1 回の呼び出しにまとめる。ユーザーが存在するトークンだけを更新し、失効・表示名変更は毎回 DB で確認する。ユーザー別の PARA / medallion / scheme 設定は 3 つの `EXISTS` を 1 つの SQL で確認する。認証とサーバー構築を行うリクエストの共通部分では、D1 呼び出しが 5 回から 2 回になる。通信待ちとバインディング処理を削減する変更であり、CPU 時間の削減幅と無料枠への適合は反映後の本番ログで確認する。

ローカルの比較用に、Worker パッケージのディレクトリで実行できるスクリプトを用意している。

```sh
node --experimental-strip-types scripts/benchmark-mcp.mjs
```

実際の MCP SDK に HTTP `tools/list` を 220 回送り、20 回のウォームアップ後の 200 回について Node の CPU / 経過時間の中央値を出す。38 ツールを有効にし、D1 と認証アクセサーだけをテスト用に置き換えている。比較対象の `tools.ts` を同じディレクトリに置き、そのパスを引数に渡すと変更前も測定できる。認証の実処理、実際の DB、他のツール、コールドスタートは含まれないため、本番の 10 ms 判定には Workers Logs を使う。

参考: [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)、[Workers の CPU 制限](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)、[CPU profiling と時計の制約](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/)。

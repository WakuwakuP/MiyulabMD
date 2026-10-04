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

`initialize` / `notifications/initialized` / `ping` はツールを実行しないため、同じ `tools.listChanged` capability を宣言した新しいサーバーだけを作り、ツール登録と機能設定の DB 読み取りを省く。認証はその前の `handleMcp` で毎回行い、プロトコルの入力検証・応答・終了処理は SDK に委譲する。

小さく既知の `tools/call` は、最大 38 ツールのうち呼び出し対象だけを SDK に登録する。通常の 26 ツールは機能設定によって利用可否が変わらないため、機能設定の照会も省く。共通部分の D1 呼び出しは認証の 1 回になり、実際のツール内で行う DB / 権限確認は従来どおり実行する。

PARA / medallion / scheme 系の 12 ツールと `tools/list` は毎回現在のユーザー設定を DB で確認する。無効化されたツールは従来の全登録に戻し、SDK の「tool not found」応答を維持する。サーバー・認証・機能設定はキャッシュしない。未知のツール名（`__proto__` なども含む）も全登録に戻す。

Legacy リクエストは `Content-Length` が既知かつ 2 KiB 以下の場合だけ本文の clone からメソッドとツール名を判定する。元の本文は消費しない。長さ不明・大きな本文・不正な JSON・未知のメソッド・HTTP 以外の factory 呼び出しは通常の全登録に戻す。Modern は SDK が本文との一致を検証済みの `Mcp-Method` / `Mcp-Name` を使い、すでに消費された本文は読まない。エンコードされたツール名は全登録に戻す。Legacy のルーティングヘッダーを信用して登録を省くことはない。

## 固定文字列の grep

固定文字列検索は本文を一度だけ正規化して `indexOf` で次のヒットへ移動する。行番号はヒットまでの改行から求め、本文の全行を `split` した配列や非一致行ごとの小文字化を作らない。前後の文脈だけを元の本文から取り出す。

小文字化で UTF-16 長が変わる Unicode（`İ` など）と正規表現は従来の行単位の処理に戻す。列番号、1 行あたりの最初のヒット、空の最終行、CRLF、文脈、`scannedNotes`、検索上限、`truncated` の意味は変えない。権限フィルタも検索候補の取得も変更しないため、再構築可能な FTS インデックスの更新遅れによる新しい取りこぼしは導入しない。

## ローカル比較

ローカルの比較用に、Worker パッケージのディレクトリで実行できるスクリプトを用意している。

```sh
node --experimental-strip-types scripts/benchmark-mcp.mjs
node --experimental-strip-types scripts/benchmark-mcp.mjs --full-registration
node --experimental-strip-types scripts/benchmark-search.mjs
```

`benchmark-mcp.mjs` は実際の MCP SDK に各メソッドを 220 回送り、20 回のウォームアップ後の 200 回について Node の CPU / 経過時間の中央値と機能設定の DB 読み取り回数を出す。38 ツールを有効にし、D1 と認証アクセサーだけをテスト用に置き換えている。ツール呼び出しは更新前の確認エラー（`set_edit_lock`）と SDK の入力検証エラー（`list_folder_entries` / `para_list`）を使い、DB・DO の実処理を含まない。タイミング wrapper は実行し、イベントの stdout 出力だけを抑制する。`--full-registration` はリクエスト情報を factory に渡さず、常に全登録する比較モード。比較対象の `tools.ts` のパスを引数に渡す方法も維持する。`firstRequestCpuMs` は同じ Node プロセスで各メソッドを最初に実行した診断値であり、独立した Workers のコールドスタート計測ではない。

`benchmark-search.mjs` は約 135 万文字・20 ノートの固定文字列スキャンを、元の行単位 matcher と新しい indexed matcher で比較する。DB・権限・MCP・通信処理は含まない。

2026-10-04 の同じ環境での一例（各 200 warm samples、単位 ms）:

| 検索スキャナ | 行単位 | indexed |
| --- | ---: | ---: |
| 先頭ヒット | 0.151 | 0.138 |
| 後半ヒット | 1.862 | 0.921 |
| ヒットなし | 2.044 | 0.697 |

| MCP メソッド | 常に全登録 | request-aware | 機能設定の読み取り（200 回分） |
| --- | ---: | ---: | --- |
| `initialize` | 0.475 | 0.402 | 200 → 0 |
| `notifications/initialized` | 0.269 | 0.214 | 200 → 0 |
| `ping` | 0.349 | 0.219 | 200 → 0 |
| `tools/list` | 0.540 | 0.554 | 200 → 200 |

2026-10-05 JST の追加比較（同じスクリプトで targeted registration の変更前後、各 200 warm samples、単位 ms）:

| `tools/call` の対象 | 変更前 | 対象だけを登録 | 機能設定の読み取り（200 回分） |
| --- | ---: | ---: | --- |
| `set_edit_lock`（確認エラー） | 0.396 | 0.257 | 200 → 0 |
| `list_folder_entries`（入力検証エラー） | 0.367 | 0.291 | 200 → 0 |
| `para_list`（入力検証エラー） | 0.341 | 0.228 | 200 → 200 |

以上は Node の合成比較で、MCP の認証実処理・ツール本体の DB / DO 処理・Workers のコールドスタートを含まない。`tools/list` の機能判定は意図的に残しており、すべてのメソッドの CPU が下がる変更ではない。本番の 10 ms 判定にはデプロイ後の Invocation Logs を使う。

参考: [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)、[Workers の CPU 制限](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)、[CPU profiling と時計の制約](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/)。

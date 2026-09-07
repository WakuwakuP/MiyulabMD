# ツール選択ルール

このリポジトリにはコード解析用 MCP が2つある。質問の種類で使い分ける。詳細は [docs/code-graph.md](docs/code-graph.md)。

| 質問の種類 | 使うツール | 例 |
|-----------|-----------|-----|
| 意味・目的でコードを探す | code-graph の semantic search | 「認証してる処理ある？」「エラーハンドリングどこ？」 |
| 変更の影響範囲 | code-graph `get_ast_node`（`include_impact`） | 「この変更どこに影響する？」「blast radius は？」 |
| 呼び出し元・依存・ルート追跡 | code-graph の call graph | 「verifyToken の呼び出し元は？」「何に依存してる？」 |
| 定義元・参照・型・リネーム（名前が分かっている） | lsmcp | 「NotificationChannel の定義元は？」「参照してるファイルは？」 |
| 全体構成 | code-graph の project / module overview | 「全体構成は？」 |
| 設計書 | `docs/` を Read | 「設計書とコードの関係は？」 |

## 競合回避

- 「〜の処理ある？」「〜してるコードどこ？」に lsmcp を使わない。意味検索は code-graph を先に使う。
- lsmcp はシンボル名が特定できている質問（定義元・参照先・型・リネーム）にだけ使う。
- Grep / Glob / Read はグラフで見つからないときの最終手段。非コード（Markdown、設定、CSS）は最初から Read / Grep でよい。

## フォールバック

code-graph が 0 件 → lsmcp の部分一致 → Grep / Glob / Read

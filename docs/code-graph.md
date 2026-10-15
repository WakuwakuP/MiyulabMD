# コードグラフ（Cursor / Codex / Claude）

エージェントがファイルを推測で開く代わりに、AST グラフと TypeScript の言語サーバーで答える。振り分けは [AGENTS.md](../AGENTS.md)。

| 役割 | ツール | 起動 |
|------|--------|------|
| 意味検索・呼び出し・影響範囲 | `@sdsrs/code-graph@0.136.0` | `npx -y @sdsrs/code-graph@0.136.0` |
| 定義元・参照・型・リネーム | `@mizchi/lsmcp` + 公式 `tsc --lsp` | `pnpm exec lsmcp` |

MCP 設定は [.mcp.json](../.mcp.json)（Claude Code）、[.cursor/mcp.json](../.cursor/mcp.json)、[.codex/config.toml](../.codex/config.toml)。

## 初回

前提は Node.js 22+（lsmcp の必須要件）、pnpm 10。`pnpm install` のあと、各クライアントを再起動して MCP を承認する。

```bash
# コードグラフは MCP 起動時に作る。手元で先に作るなら:
npx -y @sdsrs/code-graph@0.136.0
```

lsmcp の CLI `index` はカスタム `tsc --lsp` では動かない。エージェントが MCP 経由で検索したときに索引を作る。

生成物は git に入れない（`.code-graph/`、`.lsmcp/cache`）。

## 更新

| ツール | いつ | コマンド |
|--------|------|----------|
| code-graph | 大きな構造変更のあと、検索が古いとき | `npx -y @sdsrs/code-graph@0.136.0` の rebuild / reindex（起動時の増分で足りることが多い） |
| lsmcp | 原則不要（`tsc --lsp` がライブ） | MCP を再起動する |

lsmcp は [scripts/lsmcp-tsc.mjs](../scripts/lsmcp-tsc.mjs) 経由で TypeScript 7 の `tsc --lsp` を使う。直接 `tsc` を spawn すると、Windows では `node_modules/.bin/tsc` が `.cmd` で見つからず、file URI も `file://G:\...` になって言語サーバーが落ちる。ラッパーが実行ファイルの起動と URI の変換を行う。Linux でも同じコマンドでよい。`typescript-language-server`（旧 tsserver.js）は 7 では動かない。コンパイラを上げても MCP 設定は変えなくてよい。

# MiyulabMD

共同編集できる Markdown エディタ。Cloudflare Workers / Durable Objects / R2 / Zero Trust 上でホストし、MCP からもノートを編集できる。

設計の詳細は [docs/design.md](docs/design.md) を参照。

```
apps/web          フロント（React + Vite + CodeMirror 予定）
apps/worker       fetch 分岐 + Elysia (REST / MCP) / Durable Objects
packages/shared   権限モデルと共有型
docs/design.md    設計書
```

実装はフェーズ 0（骨格）まで。依存関係のインストールと実行は未セットアップ。

# MiyulabMD

共同編集できる Markdown エディタ。Cloudflare Workers / Durable Objects / R2 / Zero Trust 上でホストし、MCP からもノートを編集できる。

設計の詳細は [docs/design.md](docs/design.md) を参照。

```
apps/web          フロント（React + Vite + CodeMirror 予定）
apps/worker       fetch 分岐 + Elysia (REST / MCP) / Durable Objects
packages/shared   権限モデルと共有型
docs/design.md    設計書
```

## 開発環境セットアップ

前提: Node.js 20+、pnpm 10（`corepack enable` 推奨）。

```bash
# 1. 依存関係
pnpm install

# 2. Worker 用ローカルシークレット（任意だが推奨）
cp apps/worker/.dev.vars.example apps/worker/.dev.vars

# 3. ローカル D1 にマイグレーション（リモート database_id は不要）
pnpm db:migrate

# 4. 動作確認
pnpm dev:worker   # http://127.0.0.1:8787
curl http://127.0.0.1:8787/api/health   # => {"ok":true}
```

`wrangler.toml` の `database_id = "REPLACE_WITH_D1_DATABASE_ID"` はそのままでよい。`wrangler d1 ... --local` と `wrangler dev` はローカル SQLite を使う。

ローカルでは `DEV_AUTH=true`（`wrangler.toml` [vars]）により `/auth/login?email=...` でモックログインできる。**本番では必ず `DEV_AUTH=false` に設定**し、`ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` / `SESSION_SECRET` を本番値にする。

## ローカル開発の起動

API とフロントを同時に触る場合は **2 つのターミナル** で起動する。

| ターミナル | コマンド | URL |
|-----------|---------|-----|
| Worker | `pnpm dev:worker` | http://127.0.0.1:8787 |
| Web (Vite) | `pnpm dev` | http://127.0.0.1:5173 |

Vite は `/api` `/auth` `/mcp` `/ws` を Worker (`8787`) にプロキシする。フロント単体開発時は Worker も起動しておく。

Worker 単体で API だけ試す場合は `pnpm dev:worker` のみでよい。`apps/web/dist` が無い場合も `predev` が空ディレクトリを作るため起動できる（本番相当の静的配信は `pnpm --filter @miyulabmd/web build` 後）。

## CI / デプロイ

フォークや別アカウントでは、手元から対話スクリプトで Cloudflare（Access / Worker / D1 / R2）と GitHub Actions の Secrets を揃えられる。

```bash
pnpm setup:deploy
```

`wrangler login` でブラウザ認証し、セットアップ用の一時トークンを取得する。詳細は [docs/ci.md](docs/ci.md)。`main` への merge で Worker（本体 + og-fetch）をデプロイする。ローカルから出す場合は `pnpm --filter @miyulabmd/web build` のあと `pnpm --filter @miyulabmd/worker deploy`。

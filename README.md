# MiyulabMD

共同編集できる Markdown エディタ。Cloudflare Workers / Durable Objects / R2 / Zero Trust 上でホストし、MCP からもノートを編集できる。

設計の詳細は [docs/design.md](docs/design.md) を参照。エージェント向けのコードグラフは [docs/code-graph.md](docs/code-graph.md)。

```
apps/web          フロント（React + Vite + CodeMirror 予定）
apps/worker       fetch 分岐 + Elysia (REST / MCP) / Durable Objects
packages/shared   権限モデルと共有型
docs/design.md    設計書
```

## 開発環境セットアップ

前提: Node.js 24+（portless の必須要件）、pnpm 10（`corepack enable` 推奨）。

```bash
# 1. 依存関係
pnpm install

# 2. Worker 用ローカル設定（ローカルログインには必須）
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
# .dev.vars の SESSION_SECRET をローカル専用のランダムな値に変更する

# 3. ローカル D1 にマイグレーション（リモート database_id は不要）
pnpm db:migrate

# 4. 動作確認
pnpm dev
# ブラウザで http://miyulabmd.localhost:1355 を開く
# http://miyulabmd.localhost:1355/api/health => {"ok":true}
```

`wrangler.toml` の `database_id` はプレースホルダのままでよい。`wrangler d1 ... --local` と `wrangler dev` はローカル SQLite を使う。アカウント固有の D1 ID や Access チームドメインは GitHub Actions の Variables に置く。

ローカルでは `.dev.vars` の `DEV_AUTH=true` により `/auth/login?email=...` でモックログインできる。本番の `ACCESS_TEAM_DOMAIN` / `ACCESS_AUD` / `SESSION_SECRET` は Environment と Worker secret で渡す。

`.dev.vars` がない場合、サーバーと `/api/health` は動くが、`wrangler.toml` の `DEV_AUTH=false` が使われるためローカルログインは無効になる。PowerShell では `Copy-Item apps/worker/.dev.vars.example apps/worker/.dev.vars` で作成できる（既存ファイルは上書きしないこと）。`DEV_AUTH=true` と `SESSION_SECRET` を設定し、`ACCESS_AUD` は設定しない。設定後は Worker を再起動する。Web 側の `/api/auth/config` が `{"access":false,"mock":true}` なら、アカウントメニューにメールアドレス入力が表示される。

## ローカル開発の起動

リポジトリルートで **`pnpm dev` の 1 コマンド**で起動する。portless のプロキシを準備してから、mprocs が Web と Worker を同時に起動する。どちらもプロジェクトの開発依存なのでグローバルインストールは不要。

| プロセス | 単独起動コマンド | URL（標準設定） |
| ---------- | ----------------- | --------------------- |
| Web (Vite) | `pnpm dev:web` | http://miyulabmd.localhost:1355 |
| Worker | `pnpm dev:worker` | http://worker.miyulabmd.localhost:1355 |

mprocs は左の一覧に `web` / `worker`、右に選択したプロセスのログを表示する。プロセス一覧にフォーカスした状態で ↑/↓ で選択、`r` で再起動、`x` で停止、`s` で開始、`q` で両方を終了する。Ctrl+A でログ側とフォーカスを切り替える。キー操作は画面下部にも表示される。Windows ではプロファイルを読み込まない `cmd.exe /d` を使い、個人の PowerShell 起動処理を実行しない。

標準は **HTTP / 1355 番ポート / ループバックのみ**。共通の `scripts/portless.mjs` が同時起動・単独起動に同じ設定を適用する。OpenSSL のインストール、証明書の信頼登録、管理者権限は不要で、hosts ファイルも自動変更しない。Chrome / Edge / Firefox で開くこと。OS の DNS に依存する curl 等では、例えば `curl --resolve miyulabmd.localhost:1355:127.0.0.1 http://miyulabmd.localhost:1355/api/health` を使う。

HTTPS が必要な場合だけ、OpenSSL と証明書の信頼登録を準備し、`PORTLESS_HTTPS=1` を環境変数に設定して起動する（PowerShell なら `$env:PORTLESS_HTTPS="1"; pnpm dev`）。必要に応じて `PORTLESS_PORT` も指定できる。既存の共有プロキシと設定が異なる場合は、他のプロジェクトが使っていないことを確認して `pnpm exec portless proxy stop` で停止してから起動する。実際の URL は起動ログを参照。

Vite は `/api` `/auth` `/mcp` `/openapi.json` `/ws` を portless 経由で Worker にプロキシする。ブラウザでは Web 側の URL を使うことでログインと WebSocket を同一オリジンに保つ。バックエンドのポートは portless が割り当て、Worker にも `PORT` を渡すため、5173 / 8787 の空きを気にする必要はない。

Worker 単体で API だけ試す場合は `pnpm dev:worker` のみでよい。OG 取得用 Worker も従来どおり Wrangler の multi-worker 構成で起動する。`apps/web/dist` が無い場合も `predev` が空ディレクトリを作るため起動できる（本番相当の静的配信は `pnpm --filter @miyulabmd/web build` 後）。

URL はこのリポジトリ用の固定名。同じチェックアウトで `pnpm dev` と単独起動を重ねないこと。終了後も portless の共有プロキシは残る。他のプロジェクトでも使っていない場合のみ `pnpm exec portless proxy stop` で停止できる。

## CI / デプロイ

フォークや別アカウントでは、手元から対話スクリプトで Cloudflare（Access / Worker / D1 / R2）と GitHub Actions の Secrets / Variables を揃えられる。`wrangler.toml` は共通のままなので、upstream への追従でコンフリクトしにくい。

```bash
pnpm setup:deploy
```

`wrangler login` でブラウザ認証し、セットアップ用の一時トークンを取得する。詳細は [docs/ci.md](docs/ci.md)。`main` への merge で Worker（本体 + og-fetch）をデプロイする。

## ライセンス

Copyright (C) 2026 Naoki Fujisawa (WakuwakuP)

GNU Affero General Public License v3.0 or later。[LICENSE](LICENSE) を参照。方針は [docs/licenses.md](docs/licenses.md)、第三者の帰属は [THIRD_PARTY.md](THIRD_PARTY.md)。

ホストした改変版は、ネットワーク利用者へ対応するソースを提供すること（AGPL §13）。公式ソースは <https://github.com/WakuwakuP/MiyulabMD>。製品名・ロゴ・キャラクターは公式としての再利用を許可しない。

本番依存のライセンスは `pnpm licenses:check` で検証する。

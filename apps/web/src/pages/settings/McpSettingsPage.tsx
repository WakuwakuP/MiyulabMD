import { type FormEvent, useEffect, useState } from "react";
import { McpClientGuide } from "../../components/settings/McpClientGuide.tsx";
import { McpSetupHelp } from "../../components/settings/McpSetupHelp.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Field, Row } from "../../components/ui/Field.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { ErrorText, MutedText } from "../../components/ui/Text.tsx";
import {
  type ApiTokenCreated,
  type ApiTokenSummary,
  createToken,
  fetchMe,
  fetchTokens,
  revokeToken,
} from "../../lib/api.ts";

function formatTimestamp(ms: number | null): string {
  if (ms === null) return "未使用";
  return new Date(ms).toLocaleString();
}

export function McpSettingsPage() {
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<ApiTokenCreated | null>(
    null,
  );
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);

  async function loadTokens() {
    setLoading(true);
    setError(null);

    const nextUser = await fetchMe();
    setLoggedIn(nextUser !== null);
    if (!nextUser) {
      setTokens([]);
      setLoading(false);
      return;
    }

    const result = await fetchTokens();
    if (!result.ok) {
      setError(result.error);
      setLoading(false);
      return;
    }

    setTokens(result.data);
    setLoading(false);
  }

  useEffect(() => {
    void loadTokens();
  }, []);

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("トークン名を入力してください。");
      return;
    }

    setCreating(true);
    setError(null);

    const result = await createToken(trimmedName);
    if (!result.ok) {
      setError(
        result.status === 401
          ? "トークンを発行するにはログインが必要です。"
          : result.error,
      );
      setCreating(false);
      return;
    }

    setCreatedToken(result.data);
    setName("");
    setCreating(false);
    await loadTokens();
  }

  async function handleRevoke(id: string) {
    setError(null);
    const result = await revokeToken(id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (createdToken?.id === id) {
      setCreatedToken(null);
    }
    await loadTokens();
  }

  return (
    <section>
      <h2 className="m-0 text-[1.5em] font-bold">MCP設定</h2>
      <p>
        Cursor / Claude Code / VS Code などの MCP クライアントから{" "}
        <code className="font-mono">/mcp</code>{" "}
        に接続するためのトークンです。同じトークンで記事 API（
        <code className="font-mono">/api/articles</code>、
        <code className="font-mono">/openapi.json</code>
        ）も使えます。発行時に接続先とクライアント別の設定を一度だけ表示します。
      </p>

      {loggedIn === false && (
        <ErrorText>トークンを管理するにはログインしてください。</ErrorText>
      )}

      {error && <ErrorText>{error}</ErrorText>}

      {loggedIn && (
        <>
          <form onSubmit={(event) => void handleCreate(event)}>
            <Field label="トークン名" htmlFor="token-name">
              <Row className="mt-[0.35rem] max-[640px]:flex-col">
                <Input
                  id="token-name"
                  className="flex-1"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例: Cursor on laptop"
                  disabled={creating}
                />
                <Button variant="outline" type="submit" disabled={creating}>
                  {creating ? "発行中…" : "トークンを発行"}
                </Button>
              </Row>
            </Field>
          </form>

          {createdToken ? (
            <McpSetupHelp
              origin={window.location.origin}
              token={createdToken.token}
              tokenName={createdToken.name}
              onClose={() => setCreatedToken(null)}
            />
          ) : (
            <McpClientGuide origin={window.location.origin} />
          )}

          {loading ? (
            <p>読み込み中…</p>
          ) : tokens.length === 0 ? (
            <p>発行済みトークンはありません。</p>
          ) : (
            <ul className="list-none p-0">
              {tokens.map((token) => (
                <li
                  key={token.id}
                  className="flex justify-between gap-4 border-b border-border py-3 max-[640px]:flex-col max-[640px]:items-start"
                >
                  <div>
                    <strong>{token.name}</strong>
                    <MutedText className="mt-1">
                      作成: {formatTimestamp(token.createdAt)} / 最終利用:{" "}
                      {formatTimestamp(token.lastUsedAt)}
                    </MutedText>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => void handleRevoke(token.id)}
                  >
                    失効
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

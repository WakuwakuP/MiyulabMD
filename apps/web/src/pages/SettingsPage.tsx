import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router";
import type { AppShellContext } from "../components/layout/AppShellContext.ts";
import {
  createToken,
  fetchMe,
  fetchTokens,
  revokeToken,
  updateProfile,
  type ApiTokenCreated,
  type ApiTokenSummary,
} from "../lib/api.ts";

function formatTimestamp(ms: number | null): string {
  if (ms === null) {
    return "未使用";
  }
  return new Date(ms).toLocaleString();
}

export function SettingsPage() {
  const { user, setUser, setHeader } = useOutletContext<AppShellContext>();
  const [tokens, setTokens] = useState<ApiTokenSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createdToken, setCreatedToken] = useState<ApiTokenCreated | null>(null);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSaved, setProfileSaved] = useState(false);

  async function loadTokens() {
    setLoading(true);
    setError(null);

    const user = await fetchMe();
    setLoggedIn(user !== null);
    if (!user) {
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

  useEffect(() => {
    setHeader({ title: "設定" });
    return () => setHeader(null);
  }, [setHeader]);

  useEffect(() => {
    setDisplayName(user?.displayName ?? "");
  }, [user?.displayName]);

  async function handleProfileSave(event: FormEvent) {
    event.preventDefault();
    setSavingProfile(true);
    setError(null);
    setProfileSaved(false);

    const result = await updateProfile(displayName.trim() || null);
    if (!result.ok) {
      setError(result.status === 401 ? "表示名を保存するにはログインが必要です。" : result.error);
      setSavingProfile(false);
      return;
    }

    setUser(result.data);
    setSavingProfile(false);
    setProfileSaved(true);
  }

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
    <section className="settings-page">
      <section className="settings-section">
        <h2>プロフィール</h2>
        <p>
          共同編集中のカーソル名に使います。空欄ならメールアドレスを表示します。必須ではありません。
        </p>
        {user ? (
          <form className="profile-form" onSubmit={(event) => void handleProfileSave(event)}>
            <label htmlFor="display-name">表示名</label>
            <div className="token-create-row">
              <input
                id="display-name"
                type="text"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder={user.email}
                disabled={savingProfile}
              />
              <button type="submit" disabled={savingProfile}>
                {savingProfile ? "保存中…" : "保存"}
              </button>
            </div>
            {profileSaved && <p className="token-meta">保存しました。</p>}
          </form>
        ) : (
          <p className="page-error">表示名を設定するにはログインしてください。</p>
        )}
      </section>

      <section className="settings-section">
        <h2>MCP 用 Personal Access Token</h2>
        <p>
          Cursor などの MCP クライアントから <code>/mcp</code> に接続するためのトークンです。
          発行時に一度だけ表示されます。
        </p>

        {loggedIn === false && (
          <p className="page-error">トークンを管理するにはログインしてください。</p>
        )}

        {error && <p className="page-error">{error}</p>}

        {loggedIn && (
          <>
            <form className="token-create-form" onSubmit={handleCreate}>
              <label htmlFor="token-name">トークン名</label>
              <div className="token-create-row">
                <input
                  id="token-name"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例: Cursor on laptop"
                  disabled={creating}
                />
                <button type="submit" disabled={creating}>
                  {creating ? "発行中…" : "トークンを発行"}
                </button>
              </div>
            </form>

            {createdToken && (
              <div className="token-secret" role="status">
                <p>
                  <strong>{createdToken.name}</strong> を発行しました。この値は再表示できません。
                </p>
                <code>{createdToken.token}</code>
                <button type="button" onClick={() => setCreatedToken(null)}>
                  閉じる
                </button>
              </div>
            )}

            {loading ? (
              <p>読み込み中…</p>
            ) : tokens.length === 0 ? (
              <p>発行済みトークンはありません。</p>
            ) : (
              <ul className="token-list">
                {tokens.map((token) => (
                  <li key={token.id} className="token-list-item">
                    <div>
                      <strong>{token.name}</strong>
                      <p className="token-meta">
                        作成: {formatTimestamp(token.createdAt)} / 最終利用:{" "}
                        {formatTimestamp(token.lastUsedAt)}
                      </p>
                    </div>
                    <button type="button" onClick={() => void handleRevoke(token.id)}>
                      失効
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </section>
  );
}

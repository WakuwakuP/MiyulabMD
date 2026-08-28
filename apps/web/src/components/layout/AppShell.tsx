import type { SessionUser } from "@miyulabmd/shared";
import { type FormEvent, useEffect, useState } from "react";
import { Link, Outlet } from "react-router";
import { fetchAuthConfig, fetchMe, type AuthConfig } from "../../lib/api.ts";
import type { AppShellContext } from "./AppShellContext.ts";

export function AppShell() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig>({ access: false, mock: true });
  const [loading, setLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState("dev@example.com");

  useEffect(() => {
    Promise.all([fetchMe(), fetchAuthConfig()])
      .then(([nextUser, config]) => {
        setUser(nextUser);
        setAuthConfig(config);
      })
      .finally(() => setLoading(false));
  }, []);

  function handleLogout() {
    window.location.href = "/auth/logout";
  }

  function handleLoginSubmit(event: FormEvent) {
    event.preventDefault();
    const email = loginEmail.trim();
    if (!email) return;
    window.location.href = `/auth/login?email=${encodeURIComponent(email)}`;
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link to="/" className="app-brand">
          MiyulabMD
        </Link>
        <nav className="app-nav">
          <Link to="/settings">設定</Link>
          {loading ? (
            <span className="app-auth">…</span>
          ) : user ? (
            <span className="app-auth">
              <span className="app-user">{user.displayName?.trim() || user.email}</span>
              <button type="button" onClick={handleLogout}>
                ログアウト
              </button>
            </span>
          ) : (
            authConfig.access || !authConfig.mock ? (
              <a className="app-login-link" href="/auth/login">
                ログイン
              </a>
            ) : (
              <form className="app-login-form" onSubmit={handleLoginSubmit}>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  placeholder="email"
                  aria-label="ログイン用メールアドレス"
                />
                <button type="submit">ログイン</button>
              </form>
            )
          )}
        </nav>
      </header>
      <main className="app-main">
        <Outlet context={{ user, userLoading: loading, setUser } satisfies AppShellContext} />
      </main>
    </div>
  );
}

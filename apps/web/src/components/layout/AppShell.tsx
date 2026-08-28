import type { ReactNode } from "react";
import type { SessionUser } from "@miyulabmd/shared";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link, Outlet } from "react-router";
import { fetchAuthConfig, fetchMe, type AuthConfig } from "../../lib/api.ts";
import { AccountMenu } from "./AccountMenu.tsx";
import type { AppShellContext, HeaderLayout } from "./AppShellContext.ts";

export function AppShell() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig>({ access: false, mock: true });
  const [loading, setLoading] = useState(true);
  const [loginEmail, setLoginEmail] = useState("dev@example.com");
  const [headerTitle, setHeaderTitle] = useState<string | undefined>();
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const [layout, setLayout] = useState<HeaderLayout>("page");

  useEffect(() => {
    Promise.all([fetchMe(), fetchAuthConfig()])
      .then(([nextUser, config]) => {
        setUser(nextUser);
        setAuthConfig(config);
      })
      .finally(() => setLoading(false));
  }, []);

  function handleLoginSubmit(event: FormEvent) {
    event.preventDefault();
    const email = loginEmail.trim();
    if (!email) return;
    window.location.href = `/auth/login?email=${encodeURIComponent(email)}`;
  }

  const setHeader = useCallback((next: Parameters<AppShellContext["setHeader"]>[0]) => {
    setHeaderTitle(next?.title);
    setHeaderActions(next?.actions ?? null);
    setLayout(next?.layout ?? "page");
  }, []);

  const context: AppShellContext = {
    user,
    userLoading: loading,
    setUser,
    setHeader,
  };

  return (
    <div className={layout === "editor" ? "app-shell app-shell--editor" : "app-shell"}>
      <header className="app-header">
        <div className="app-header-start">
          <Link to="/" className="app-brand">
            MiyulabMD
          </Link>
          {headerTitle && <span className="app-header-title">{headerTitle}</span>}
        </div>
        <div className="app-header-center">{headerActions}</div>
        <nav className="app-nav">
          {loading ? (
            <span className="app-auth">…</span>
          ) : user ? (
            <AccountMenu user={user} />
          ) : authConfig.access || !authConfig.mock ? (
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
          )}
        </nav>
      </header>
      <main className={layout === "editor" ? "app-main app-main--editor" : "app-main"}>
        <Outlet context={context} />
      </main>
    </div>
  );
}

import type { SessionUser } from "@miyulabmd/shared";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { Link } from "react-router";
import type { AuthConfig } from "../../lib/api.ts";
import { Button } from "../ui/Button.tsx";
import { AccountMenu } from "./AccountMenu.tsx";
import styles from "./header.module.css";

type Props = {
  title?: string;
  actions?: ReactNode;
  end?: ReactNode;
  user: SessionUser | null;
  loading: boolean;
  authConfig: AuthConfig;
};

export function AppHeader({ title, actions, end, user, loading, authConfig }: Props) {
  const [loginEmail, setLoginEmail] = useState("dev@example.com");

  function handleLoginSubmit(event: FormEvent) {
    event.preventDefault();
    const email = loginEmail.trim();
    if (!email) return;
    window.location.href = `/auth/login?email=${encodeURIComponent(email)}`;
  }

  return (
    <header className={styles.header}>
      <div className={styles.start}>
        <Link to="/" className={styles.brand}>
          MiyulabMD
        </Link>
        {title && <span className={styles.title}>{title}</span>}
      </div>
      <div className={styles.center}>{actions}</div>
      <nav className={styles.end}>
        {end}
        {loading ? (
          <span className="text-[var(--muted)]">…</span>
        ) : user ? (
          <AccountMenu user={user} />
        ) : authConfig.access || !authConfig.mock ? (
          <a className="text-[var(--accent)] no-underline" href="/auth/login">
            ログイン
          </a>
        ) : (
          <form className="flex items-center gap-2" onSubmit={handleLoginSubmit}>
            <input
              className={styles.loginInput}
              type="email"
              value={loginEmail}
              onChange={(event) => setLoginEmail(event.target.value)}
              placeholder="email"
              aria-label="ログイン用メールアドレス"
            />
            <Button variant="outline" type="submit">
              ログイン
            </Button>
          </form>
        )}
      </nav>
    </header>
  );
}

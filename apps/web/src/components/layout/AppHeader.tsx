import type { SessionUser } from "@miyulabmd/shared";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { Link } from "react-router";
import type { AuthConfig } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { Button } from "../ui/Button.tsx";
import { Input } from "../ui/Input.tsx";
import { MutedText } from "../ui/Text.tsx";
import { AccountMenu } from "./AccountMenu.tsx";

type Props = {
  title?: string;
  actions?: ReactNode;
  end?: ReactNode;
  user: SessionUser | null;
  loading: boolean;
  authConfig: AuthConfig;
};

export function AppHeader({
  title,
  actions,
  end,
  user,
  loading,
  authConfig,
}: Props) {
  const [loginEmail, setLoginEmail] = useState("dev@example.com");

  function handleLoginSubmit(event: FormEvent) {
    event.preventDefault();
    const email = loginEmail.trim();
    if (!email) return;
    window.location.href = `/auth/login?email=${encodeURIComponent(email)}`;
  }

  return (
    <header
      className={cn(
        "grid min-h-[3.25rem] items-center gap-3 border-b border-border bg-surface px-[0.9rem] py-[0.4rem]",
        actions
          ? "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] max-[900px]:grid-cols-[1fr_auto]"
          : "grid-cols-[minmax(0,1fr)_auto]",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Link to="/" className="shrink-0 font-bold text-inherit no-underline">
          MiyulabMD
        </Link>
        {title && (
          <span className="overflow-hidden text-ellipsis whitespace-nowrap font-semibold">
            {title}
          </span>
        )}
      </div>
      {actions && (
        <div className="flex min-w-0 items-center justify-center max-[900px]:order-3 max-[900px]:col-span-full">
          {actions}
        </div>
      )}
      <nav className="flex min-w-0 items-center justify-end gap-2">
        {end}
        {loading ? (
          <MutedText className="m-0">…</MutedText>
        ) : user ? (
          <AccountMenu user={user} />
        ) : authConfig.access || !authConfig.mock ? (
          <a className="text-accent no-underline" href="/auth/login">
            ログイン
          </a>
        ) : (
          <form
            className="flex items-center gap-2"
            onSubmit={handleLoginSubmit}
          >
            <Input
              variant="pill"
              className="min-w-48"
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

import type { SessionUser } from "@miyulabmd/shared";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { AuthConfig } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { MutedText } from "../ui/Text.tsx";
import { AccountMenu } from "./AccountMenu.tsx";

type Props = {
  actions?: ReactNode;
  end?: ReactNode;
  user: SessionUser | null;
  loading: boolean;
  authConfig: AuthConfig;
};

export function AppHeader({ actions, end, user, loading, authConfig }: Props) {
  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-40 grid min-h-[3.25rem] items-center gap-2 border-b border-border bg-surface px-[0.9rem] py-[0.4rem] max-[900px]:px-3",
        actions
          ? "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
          : "grid-cols-[minmax(0,1fr)_auto]",
      )}
    >
      <div className="flex min-w-0 items-center">
        <Link to="/" className="shrink-0 font-bold text-inherit no-underline">
          MiyulabMD
        </Link>
      </div>
      {actions && (
        <div className="flex min-w-0 items-center justify-center">
          {actions}
        </div>
      )}
      <nav className="flex min-w-0 items-center justify-end gap-2 max-[900px]:gap-1">
        {end}
        {loading ? (
          <MutedText className="m-0">…</MutedText>
        ) : (
          <AccountMenu user={user} authConfig={authConfig} />
        )}
      </nav>
    </header>
  );
}

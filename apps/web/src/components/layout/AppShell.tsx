import type { SessionUser } from "@miyulabmd/shared";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Outlet } from "react-router";
import { type AuthConfig, fetchAuthConfig, fetchMe } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { AppHeader } from "./AppHeader.tsx";
import type { AppShellContext, HeaderLayout } from "./AppShellContext.ts";

export function AppShell() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig>({
    access: false,
    mock: true,
  });
  const [loading, setLoading] = useState(true);
  const [headerTitle, setHeaderTitle] = useState<string | undefined>();
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const [headerEnd, setHeaderEnd] = useState<ReactNode>(null);
  const [layout, setLayout] = useState<HeaderLayout>("page");
  const editor = layout === "editor";

  useEffect(() => {
    Promise.all([fetchMe(), fetchAuthConfig()])
      .then(([nextUser, config]) => {
        setUser(nextUser);
        setAuthConfig(config);
      })
      .finally(() => setLoading(false));
  }, []);

  const setHeader = useCallback(
    (next: Parameters<AppShellContext["setHeader"]>[0]) => {
      setHeaderTitle(next?.title);
      setHeaderActions(next?.actions ?? null);
      setHeaderEnd(next?.end ?? null);
      setLayout(next?.layout ?? "page");
    },
    [],
  );

  const context: AppShellContext = {
    user,
    userLoading: loading,
    setUser,
    setHeader,
  };

  return (
    <div
      data-layout={layout}
      className={cn(
        "flex min-h-dvh flex-col",
        editor && "h-dvh overflow-hidden",
      )}
    >
      <AppHeader
        title={headerTitle}
        actions={headerActions}
        end={headerEnd}
        user={user}
        loading={loading}
        authConfig={authConfig}
      />
      <main
        className={cn(
          "mx-auto w-full max-w-[1400px] flex-1 p-5",
          editor && "m-0 min-h-0 max-w-none overflow-hidden p-0",
        )}
      >
        <Outlet context={context} />
      </main>
    </div>
  );
}

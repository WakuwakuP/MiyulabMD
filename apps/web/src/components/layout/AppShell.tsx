import type { SessionUser } from "@miyulabmd/shared";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Outlet } from "react-router";
import { fetchAuthConfig, fetchMe, type AuthConfig } from "../../lib/api.ts";
import { AppHeader } from "./AppHeader.tsx";
import type { AppShellContext, HeaderLayout } from "./AppShellContext.ts";

export function AppShell() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig>({ access: false, mock: true });
  const [loading, setLoading] = useState(true);
  const [headerTitle, setHeaderTitle] = useState<string | undefined>();
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const [headerEnd, setHeaderEnd] = useState<ReactNode>(null);
  const [layout, setLayout] = useState<HeaderLayout>("page");

  useEffect(() => {
    Promise.all([fetchMe(), fetchAuthConfig()])
      .then(([nextUser, config]) => {
        setUser(nextUser);
        setAuthConfig(config);
      })
      .finally(() => setLoading(false));
  }, []);

  const setHeader = useCallback((next: Parameters<AppShellContext["setHeader"]>[0]) => {
    setHeaderTitle(next?.title);
    setHeaderActions(next?.actions ?? null);
    setHeaderEnd(next?.end ?? null);
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
      <AppHeader
        title={headerTitle}
        actions={headerActions}
        end={headerEnd}
        user={user}
        loading={loading}
        authConfig={authConfig}
      />
      <main className={layout === "editor" ? "app-main app-main--editor" : "app-main"}>
        <Outlet context={context} />
      </main>
    </div>
  );
}

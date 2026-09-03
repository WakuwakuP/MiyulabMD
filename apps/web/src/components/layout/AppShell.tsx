import type { SessionUser } from "@miyulabmd/shared";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { type AuthConfig, fetchAuthConfig, fetchMe } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { AppHeader } from "./AppHeader.tsx";
import type { AppShellContext, HeaderLayout } from "./AppShellContext.ts";

function isEditorPath(pathname: string): boolean {
  return pathname.startsWith("/n/") || pathname.startsWith("/s/");
}

export function AppShell() {
  const { pathname } = useLocation();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig>({
    access: false,
    mock: true,
  });
  const [loading, setLoading] = useState(true);
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const [headerEnd, setHeaderEnd] = useState<ReactNode>(null);
  const [layout, setLayout] = useState<HeaderLayout>("page");
  const editor = isEditorPath(pathname) || layout === "editor";

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
      data-layout={editor ? "editor" : "page"}
      className={cn(
        "flex flex-col",
        editor ? "h-full min-h-0" : "min-h-[var(--app-height,100dvh)]",
      )}
    >
      <AppHeader
        actions={headerActions}
        end={headerEnd}
        user={user}
        loading={loading}
        authConfig={authConfig}
      />
      <main
        className={
          editor
            ? "flex min-h-0 w-full flex-1 flex-col pt-[var(--header-height)]"
            : "mx-auto w-full max-w-[1400px] flex-1 p-5 pt-[calc(var(--header-height)+1.25rem)] max-[640px]:px-3"
        }
      >
        <Outlet context={context} />
      </main>
    </div>
  );
}

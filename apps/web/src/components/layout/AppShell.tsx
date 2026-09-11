import type { SessionUser } from "@miyulabmd/shared";
import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router";
import { type AuthConfig, fetchAuthConfig } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import { installYjsPersistenceCleanup } from "../../lib/collaboration-persistence.ts";
import {
  getSessionSnapshot,
  hydrateSessionFromDb,
  subscribeSession,
  verifySession,
} from "../../lib/offline-session.ts";
import { AppHeader } from "./AppHeader.tsx";
import type { AppShellContext } from "./AppShellContext.ts";

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
  const [session, setSession] = useState(getSessionSnapshot);
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const [headerEnd, setHeaderEnd] = useState<ReactNode>(null);
  const [headerFolder, setHeaderFolder] = useState<string | null>(null);
  const editor = isEditorPath(pathname);

  useEffect(() => {
    return subscribeSession((next) => {
      setSession(next);
      if (next.status === "online-confirmed" && next.user) {
        setUser(next.user);
      } else {
        setUser(null);
      }
    });
  }, []);

  useEffect(() => {
    installYjsPersistenceCleanup();
    Promise.all([hydrateSessionFromDb(), fetchAuthConfig()])
      .then(async ([, configResult]) => {
        if (configResult.ok) {
          setAuthConfig(configResult.data);
        } else {
          setAuthConfig({ access: false, mock: true });
        }
        await verifySession();
      })
      .finally(() => setLoading(false));
  }, []);

  const setHeader = useCallback(
    (next: Parameters<AppShellContext["setHeader"]>[0]) => {
      setHeaderActions(next?.actions ?? null);
      setHeaderEnd(next?.end ?? null);
      setHeaderFolder(next?.folder ?? null);
    },
    [],
  );

  const context: AppShellContext = {
    session,
    setHeader,
    setUser,
    user,
    userLoading: loading,
  };

  return (
    <div
      className={cn(
        "flex flex-col",
        editor ? "h-full min-h-0" : "min-h-[var(--app-height,100dvh)]",
      )}
      data-layout={editor ? "editor" : "page"}
    >
      <AppHeader
        actions={headerActions}
        authConfig={authConfig}
        end={headerEnd}
        folder={headerFolder}
        loading={loading}
        user={user}
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

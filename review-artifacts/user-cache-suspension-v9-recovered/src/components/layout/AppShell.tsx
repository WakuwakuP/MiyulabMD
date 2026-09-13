import type { SessionUser } from "@miyulabmd/shared";
import type { ReactNode } from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Outlet, useLocation } from "react-router";
import { type AuthConfig, fetchAuthConfig } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import {
  resolveViewerContext,
  type ViewerContext,
} from "../../lib/viewer-context.ts";
import {
  bindMutationAccess,
  createViewingAccess,
} from "../../lib/viewing-access.ts";
import { AppHeader } from "./AppHeader.tsx";
import type { AppShellContext } from "./AppShellContext.ts";

function isEditorPath(pathname: string): boolean {
  return pathname.startsWith("/n/") || pathname.startsWith("/s/");
}

const unavailableViewer: ViewerContext = {
  cacheViewerId: null,
  mode: "unavailable",
  user: null,
};

export function AppShell() {
  const { pathname } = useLocation();
  const [viewer, setViewer] = useState<ViewerContext>(unavailableViewer);
  const [authConfig, setAuthConfig] = useState<AuthConfig>({
    access: false,
    mock: true,
  });
  const [loading, setLoading] = useState(true);
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const [headerEnd, setHeaderEnd] = useState<ReactNode>(null);
  const [headerFolder, setHeaderFolder] = useState<string | null>(null);
  const viewerRef = useRef(viewer);
  const [viewing] = useState(() =>
    createViewingAccess(() => viewerRef.current),
  );
  const viewerRequestRef = useRef<{
    controller: AbortController;
    generation: number;
  } | null>(null);
  const generationRef = useRef(0);
  const editor = isEditorPath(pathname);

  useLayoutEffect(() => bindMutationAccess(viewing.getAccess), [viewing]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    viewerRequestRef.current = { controller, generation };

    void resolveViewerContext({ signal: controller.signal })
      .then((nextViewer) => {
        if (
          active &&
          generationRef.current === generation &&
          !controller.signal.aborted
        ) {
          viewerRef.current = nextViewer;
          setViewer(nextViewer);
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        if (!active || controller.signal.aborted) {
          return;
        }
        if (generationRef.current === generation) {
          const nextViewer = unavailableViewer;
          viewerRef.current = nextViewer;
          setViewer(nextViewer);
          setLoading(false);
        }
        console.error("Failed to resolve viewer context", error);
      });

    return () => {
      active = false;
      controller.abort();
      if (viewerRequestRef.current?.generation === generation) {
        viewerRequestRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    void fetchAuthConfig()
      .then((config) => {
        if (active) {
          setAuthConfig(config);
        }
      })
      .catch(() => {
        // Keep the existing mock-friendly default when optional config is unavailable.
      });
    return () => {
      active = false;
    };
  }, []);

  const setUser = useCallback((nextUser: SessionUser | null) => {
    const request = viewerRequestRef.current;
    generationRef.current += 1;
    request?.controller.abort();
    viewerRequestRef.current = null;

    const previousViewer = viewerRef.current;
    const nextViewer: ViewerContext = nextUser
      ? {
          cacheViewerId:
            previousViewer.user?.id === nextUser.id
              ? previousViewer.cacheViewerId
              : null,
          mode: "authenticated",
          user: nextUser,
        }
      : unavailableViewer;
    viewerRef.current = nextViewer;
    setViewer(nextViewer);
    setLoading(false);
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
    setHeader,
    setUser,
    user: viewer.user,
    userLoading: loading,
    viewer,
    viewing,
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
        user={viewer.user}
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

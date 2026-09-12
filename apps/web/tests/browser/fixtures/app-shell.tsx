import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes, useOutletContext } from "react-router";
import { AppShell } from "../../../src/components/layout/AppShell.tsx";
import type { AppShellContext } from "../../../src/components/layout/AppShellContext.ts";
import { ThemeProvider } from "../../../src/hooks/use-theme.ts";

function ViewerProbe() {
  const context = useOutletContext<AppShellContext>();
  return (
    <output aria-label="Viewer context">
      {JSON.stringify({
        user: context.user,
        userLoading: context.userLoading,
        viewer: context.viewer ?? null,
      })}
    </output>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing fixture root");
}
createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <MemoryRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route element={<ViewerProbe />} path="/" />
          </Route>
        </Routes>
      </MemoryRouter>
    </ThemeProvider>
  </StrictMode>,
);

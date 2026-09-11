import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { ThemeProvider } from "./hooks/use-theme.ts";
import { registerServiceWorker } from "./lib/pwa.ts";
import { bindVisualViewportHeight } from "./lib/visual-viewport.ts";
import "./styles/index.css";

bindVisualViewportHeight();
registerServiceWorker();

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root is missing");
}

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
);

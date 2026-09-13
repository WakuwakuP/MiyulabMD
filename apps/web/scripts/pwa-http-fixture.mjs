import { readFile } from "node:fs/promises";
import path from "node:path";

// Test-only HTTP behavior layered in front of production-preview assets.
// This plugin is not part of the app's Vite configuration or deployed Worker.
export function pwaHttpFixture(webRoot) {
  return {
    configurePreviewServer(server) {
      server.middlewares.use(async (request, response, next) => {
        try {
          const url = new URL(request.url ?? "/", "http://fixture.local");
          if (
            request.method === "GET" &&
            url.pathname === "/n/pwa-ssr-fixture"
          ) {
            const shell = await readFile(
              path.join(webRoot, "dist/index.html"),
              "utf8",
            );
            response.setHeader("Content-Type", "text/html; charset=utf-8");
            response.setHeader("Cache-Control", "private, no-store");
            response.setHeader("X-PWA-SSR-Fixture", "1");
            response.end(
              shell.replace(
                "</body>",
                '<div id="ssr-preview" data-note-id="pwa-ssr-fixture">PWA_PRIVATE_SSR_SENTINEL</div></body>',
              ),
            );
            return;
          }
          next();
        } catch (error) {
          next(error);
        }
      });
    },
    name: "pwa-http-fixture",
  };
}

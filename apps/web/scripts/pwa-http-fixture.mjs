import { readFile } from "node:fs/promises";
import path from "node:path";

async function serveFixture(request, response, server, webRoot) {
  if (request.method !== "GET") {
    return false;
  }
  const url = new URL(request.url ?? "/", "http://fixture.local");
  switch (url.pathname) {
    case "/__pwa_seed":
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(
        "<!doctype html><title>PWA storage fixture</title><p>Ready</p>",
      );
      return true;
    case "/n/pwa-foreign-fixture":
      response.statusCode = 503;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end("<!doctype html><h1>PWA_FOREIGN_FAILURE</h1>");
      return true;
    case "/n/pwa-redirect-fixture": {
      const address = server.httpServer.address();
      if (!address || typeof address === "string") {
        throw new Error("Preview address unavailable");
      }
      response.statusCode = 302;
      response.setHeader(
        "Location",
        `http://localhost:${address.port}/n/pwa-foreign-fixture`,
      );
      response.setHeader("Cache-Control", "no-store");
      response.end();
      return true;
    }
    case "/n/pwa-ssr-fixture": {
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
      return true;
    }
    default:
      return false;
  }
}

// Test-only HTTP behavior layered in front of production-preview assets.
// This plugin is not part of the app's Vite configuration or deployed Worker.
export function pwaHttpFixture(webRoot) {
  return {
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        void serveFixture(request, response, server, webRoot).then(
          (handled) => {
            if (!handled) {
              next();
            }
          },
          next,
        );
      });
    },
    name: "pwa-http-fixture",
  };
}

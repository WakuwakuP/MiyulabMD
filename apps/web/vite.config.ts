import { lookup } from "node:dns";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Keep the scheme / proxy port / TLD selected by portless.
const workerUrl = process.env.PORTLESS_URL
  ? new URL(process.env.PORTLESS_URL)
  : new URL("http://127.0.0.1:8787");
if (process.env.PORTLESS_URL) {
  workerUrl.hostname = `worker.${workerUrl.hostname}`;
}
const Agent = workerUrl.protocol === "https:" ? HttpsAgent : HttpAgent;
const workerProxy = {
  // Node's resolver does not resolve *.localhost on every OS. Connect to
  // loopback while preserving Host / TLS servername for portless routing.
  agent: process.env.PORTLESS_URL
    ? new Agent({
        lookup: (_hostname, options, callback) =>
          lookup("127.0.0.1", options, callback),
      })
    : undefined,
  changeOrigin: true,
  target: workerUrl.origin,
};

const DIAGRAM_CHUNK_DEPS =
  /node_modules[/\\](?:\.pnpm[/\\][^/\\]+[/\\]node_modules[/\\])?(?:@?mermaid|@mermaid-js|@plantuml|cytoscape|cytoscape-fcose|cytoscape-cose-bilkent|cose-base|layout-base|dagre-d3-es|non-layered-tidy-tree-layout|elkjs|katex|khroma|roughjs|stylis|ts-dedent|chevrotain|es-toolkit|@upsetjs|@iconify|@braintree|marked|dayjs|uuid|d3(?:-[\w-]+)?)[/\\]/;

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Diagram engines are heavy and only load on demand. Tag their chunks
        // so the service worker can exclude them from the precache manifest
        // and serve them via runtime caching instead. Only tag chunks made
        // purely of node_modules code: a chunk that also contains app source
        // (e.g. a shared dep like dompurify pulled into the preview path)
        // must stay precached.
        chunkFileNames: (chunkInfo) => {
          const ids = chunkInfo.moduleIds;
          // A chunk is diagram-only when it pulls in engine code and every
          // module is either a dependency or a bundler helper (virtual
          // modules carry a \0 prefix). Any app source module keeps the
          // default name so it stays precached.
          const isAppModule = (id: string) =>
            !id.includes("node_modules") && !id.includes("\0");
          const isDiagramOnly =
            ids.some((id) => DIAGRAM_CHUNK_DEPS.test(id)) &&
            !ids.some(isAppModule);
          return isDiagramOnly
            ? "assets/diagram-[name]-[hash].js"
            : "assets/[name]-[hash].js";
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      filename: "sw.js",
      injectManifest: {
        globIgnores: ["assets/diagram-*", "diagram/**"],
        globPatterns: [
          "index.html",
          "manifest.webmanifest",
          "assets/**/*.{js,css,svg,png,webp,woff,woff2,ico}",
          "icon.svg",
        ],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      injectRegister: null,
      manifest: {
        display: "standalone",
        icons: [
          {
            purpose: "any maskable",
            sizes: "any",
            src: "/icon.svg",
            type: "image/svg+xml",
          },
        ],
        name: "MiyulabMD",
        scope: "/",
        short_name: "MiyulabMD",
        start_url: "/",
      },
      srcDir: "service-worker",
      strategies: "injectManifest",
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: Number(process.env.PORT || 5173),
    proxy: {
      "/api": workerProxy,
      "/auth": workerProxy,
      "/mcp": workerProxy,
      "/openapi.json": workerProxy,
      "/ws": { ...workerProxy, ws: true },
    },
    strictPort: true,
  },
});

import { lookup } from "node:dns";
import { Agent as HttpAgent } from "node:http";
import { Agent as HttpsAgent } from "node:https";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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

export default defineConfig({
  plugins: [react(), tailwindcss()],
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

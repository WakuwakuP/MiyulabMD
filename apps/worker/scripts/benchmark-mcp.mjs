import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  configureFeatures,
  getFeatureReadCount,
  resetFeatureReadCount,
  runAs,
  setupMcpTestRuntime,
} from "./mcp-test-runtime.mjs";

// Synthetic warm-request comparison: real MCP HTTP handling, mocked D1/auth.
// Node CPU measurements include response consumption and are not Workers CPU.
setupMcpTestRuntime();
const user = {
  displayName: "Benchmark",
  email: "benchmark@example.invalid",
  id: "benchmark",
};
configureFeatures(user.id, { medallion: true, para: true, schemes: true });
const args = process.argv.slice(2);
const fullRegistration = args.includes("--full-registration");
const modulePath = args.find((arg) => !arg.startsWith("--"));
const moduleUrl = modulePath
  ? pathToFileURL(resolve(modulePath))
  : new URL("../src/mcp/tools.ts", import.meta.url);
const { createMcpServerFactory } = await import(moduleUrl.href);
const handler = createMcpHandler(
  fullRegistration ? () => createMcpServerFactory() : createMcpServerFactory,
);
for (const method of [
  "initialize",
  "notifications/initialized",
  "ping",
  "tools/list",
]) {
  const samples = [];
  let firstRequestCpuMs;
  for (let i = 0; i < 220; i++) {
    if (i === 20) {
      resetFeatureReadCount();
    }
    const started = performance.now();
    const cpu = process.cpuUsage();
    const body = JSON.stringify({
      ...(method === "notifications/initialized" ? {} : { id: 1 }),
      jsonrpc: "2.0",
      method,
      ...(method === "initialize"
        ? {
            params: {
              capabilities: {},
              clientInfo: { name: "benchmark", version: "1" },
              protocolVersion: "2025-06-18",
            },
          }
        : {}),
    });
    await runAs(user, async () => {
      const response = await handler.fetch(
        new Request("https://md.example.invalid/mcp", {
          body,
          headers: {
            Accept: "application/json, text/event-stream",
            "Content-Length": String(Buffer.byteLength(body)),
            "Content-Type": "application/json",
            "MCP-Protocol-Version": "2025-06-18",
          },
          method: "POST",
        }),
      );
      if (!response.ok) {
        throw new Error(`Unexpected MCP status: ${response.status}`);
      }
      await response.text();
    });
    const spent = process.cpuUsage(cpu);
    if (i === 0) {
      firstRequestCpuMs = (spent.user + spent.system) / 1000;
    }
    if (i >= 20) {
      samples.push({
        cpu: (spent.user + spent.system) / 1000,
        wall: performance.now() - started,
      });
    }
  }
  const median = (key) =>
    samples.map((sample) => sample[key]).sort((a, b) => a - b)[100];
  console.log({
    cpuMedianMs: median("cpu"),
    featureReads: getFeatureReadCount(),
    firstRequestCpuMs,
    method,
    module: moduleUrl.pathname,
    samples: samples.length,
    variant: fullRegistration ? "full_registration" : "request_aware",
    wallMedianMs: median("wall"),
  });
}

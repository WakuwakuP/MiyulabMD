import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  configureFeatures,
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
const moduleUrl = process.argv[2]
  ? pathToFileURL(resolve(process.argv[2]))
  : new URL("../src/mcp/tools.ts", import.meta.url);
const { createMcpServerFactory } = await import(moduleUrl.href);
const handler = createMcpHandler(createMcpServerFactory);
const samples = [];
for (let i = 0; i < 220; i++) {
  const started = performance.now();
  const cpu = process.cpuUsage();
  await runAs(user, async () => {
    const response = await handler.fetch(
      new Request("https://md.example.invalid/mcp", {
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "tools/list" }),
        headers: {
          Accept: "application/json, text/event-stream",
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
  module: moduleUrl.pathname,
  samples: samples.length,
  wallMedianMs: median("wall"),
});

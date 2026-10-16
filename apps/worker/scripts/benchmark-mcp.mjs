import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  createMcpHandler,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import {
  configureFeatures,
  getFeatureReadCount,
  resetFeatureReadCount,
  runAs,
  setupMcpTestRuntime,
} from "./mcp-test-runtime.mjs";

// Synthetic warm-request comparison: real MCP HTTP handling, mocked D1/auth.
// Node CPU measurements include response consumption and are not Workers CPU.
// Resolve before the test hook substitutes the auth accessor. Importing the
// resolved entry lets --agents include the real production HTTP/auth wrappers.
const agentsEntry = import.meta.resolve("agents/mcp/server");
setupMcpTestRuntime();
const user = {
  displayName: "Benchmark",
  email: "benchmark@example.invalid",
  id: "benchmark",
};
configureFeatures(user.id, { medallion: true, para: true, schemes: true });
const args = process.argv.slice(2);
const fullRegistration = args.includes("--full-registration");
const agentsWrapper = args.includes("--agents");
const modern = args.includes("--modern");
const protocol = modern ? "2026-07-28" : "2025-06-18";
const modulePath = args.find((arg) => !arg.startsWith("--"));
const moduleUrl = modulePath
  ? pathToFileURL(resolve(modulePath))
  : new URL("../src/mcp/tools.ts", import.meta.url);
const { createMcpServerFactory } = await import(moduleUrl.href);
const createHandler = agentsWrapper
  ? (await import(agentsEntry)).createMcpHandler
  : createMcpHandler;
const variants = (
  args.includes("--compare") ? [true, false] : [fullRegistration]
).map((full) => ({
  handler: createHandler(
    full ? () => createMcpServerFactory() : createMcpServerFactory,
  ),
  name: full ? "full_registration" : "request_aware",
}));
// Avoid flooding stdout with per-call timing events. The timing wrapper and
// the real SDK still run; only the log sink is replaced in this local benchmark.
const log = console.log;
console.log = (event) => {
  if (event?.event !== "mcp_tool_timing" && event?.event !== "mcp_dispatch") {
    log(event);
  }
};
for (const { method, params } of [
  ...(modern
    ? [{ method: "server/discover" }]
    : [
        {
          method: "initialize",
          params: {
            capabilities: {},
            clientInfo: { name: "benchmark", version: "1" },
            protocolVersion: protocol,
          },
        },
        { method: "notifications/initialized" },
      ]),
  ...(modern ? [] : [{ method: "ping" }]),
  { method: "tools/list" },
  {
    method: "tools/call",
    params: {
      arguments: { id: "note", locked: false },
      name: "set_edit_lock",
    },
  },
  {
    method: "tools/call",
    params: { arguments: { limit: 0 }, name: "list_folder_entries" },
  },
  {
    method: "tools/call",
    params: { arguments: { bucket: "invalid" }, name: "para_list" },
  },
]) {
  const measurements = variants.map((variant) => ({
    ...variant,
    firstRequestCpuMs: undefined,
    samples: [],
  }));
  const requestParams = modern
    ? {
        ...params,
        _meta: {
          [CLIENT_CAPABILITIES_META_KEY]: {},
          [CLIENT_INFO_META_KEY]: { name: "benchmark", version: "1" },
          [PROTOCOL_VERSION_META_KEY]: protocol,
        },
      }
    : params;
  for (let i = 0; i < 220; i++) {
    // Alternate the order within one process to reduce JIT/load/order bias.
    for (const measurement of i % 2
      ? measurements
      : measurements.toReversed()) {
      resetFeatureReadCount();
      const started = performance.now();
      const cpu = process.cpuUsage();
      const body = JSON.stringify({
        ...(method === "notifications/initialized" ? {} : { id: 1 }),
        jsonrpc: "2.0",
        method,
        ...(requestParams ? { params: requestParams } : {}),
      });
      await runAs(user, async () => {
        const request = new Request("https://md.example.invalid/mcp", {
          body,
          headers: {
            Accept: "application/json, text/event-stream",
            "Content-Length": String(Buffer.byteLength(body)),
            "Content-Type": "application/json",
            "MCP-Protocol-Version": protocol,
            ...(modern ? { "Mcp-Method": method } : {}),
            ...(modern && params?.name ? { "Mcp-Name": params.name } : {}),
          },
          method: "POST",
        });
        const response = agentsWrapper
          ? await measurement.handler(request, {}, { props: { user } })
          : await measurement.handler.fetch(request);
        if (!response.ok) {
          throw new Error(
            `Unexpected MCP status: ${response.status}: ${await response.text()}`,
          );
        }
        await response.text();
      });
      const spent = process.cpuUsage(cpu);
      if (i === 0) {
        measurement.firstRequestCpuMs = (spent.user + spent.system) / 1000;
      }
      if (i >= 20) {
        measurement.samples.push({
          cpu: (spent.user + spent.system) / 1000,
          featureReads: getFeatureReadCount(),
          wall: performance.now() - started,
        });
      }
    }
  }
  for (const { samples, firstRequestCpuMs, name } of measurements) {
    const median = (key) =>
      samples.map((sample) => sample[key]).sort((a, b) => a - b)[100];
    console.log({
      cpuMedianMs: median("cpu"),
      featureReads: samples.reduce(
        (sum, sample) => sum + sample.featureReads,
        0,
      ),
      firstRequestCpuMs,
      method,
      middleware: agentsWrapper ? "agents" : "sdk",
      module: moduleUrl.pathname,
      protocol,
      samples: samples.length,
      tool: params?.name,
      variant: name,
      wallMedianMs: median("wall"),
    });
  }
}

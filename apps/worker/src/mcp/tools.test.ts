import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  createMcpHandler,
  McpServer,
  PROTOCOL_VERSION_META_KEY,
} from "@modelcontextprotocol/server";
import {
  configureFeatures,
  getFeatureReadCount,
  resetFeatureReadCount,
  runAs,
  setupMcpTestRuntime,
} from "../../scripts/mcp-test-runtime.mjs";

setupMcpTestRuntime();
const { createMcpServerFactory } = await import("./tools.ts");
const { toolDefinitions } = await import("./tool-definitions.ts");
const handler = createMcpHandler(createMcpServerFactory);

type User = { id: string; email: string; displayName: string | null };
type RpcResponse = {
  error?: { code: number; message: string };
  result?: {
    capabilities?: unknown;
    content: { text: string }[];
    isError?: boolean;
    tools: { name: string }[];
  };
};

function rpc(
  user: User | null,
  method: string,
  params = {},
  headers: Record<string, string> = {},
) {
  return runAs(user, async () => {
    const payload = JSON.stringify({ id: 1, jsonrpc: "2.0", method, params });
    const response = await handler.fetch(
      new Request("https://md.example.invalid/mcp", {
        body: payload,
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Length": String(Buffer.byteLength(payload)),
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2025-06-18",
          ...headers,
        },
        method: "POST",
      }),
    );
    assert.equal(response.status, 200);
    const body = await response.text();
    const data = body.startsWith("{")
      ? body
      : body
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice(6);
    assert.ok(data);
    return JSON.parse(data) as RpcResponse;
  });
}

const user = (id: string): User => ({
  displayName: id,
  email: `${id}@example.invalid`,
  id,
});

test("each known small tool call registers only its target and only gated tools read features", async (t) => {
  const caller = user("targeted-registration");
  configureFeatures(caller.id, { medallion: true, para: true, schemes: true });
  const registered = t.mock.method(McpServer.prototype, "registerTool");
  resetFeatureReadCount();
  for (const name of Object.keys(toolDefinitions)) {
    const start = registered.mock.calls.length;
    const payload = JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: {}, name },
    });
    const server = await runAs(caller, () =>
      createMcpServerFactory({
        era: "legacy",
        requestInfo: new Request("https://md.example.invalid/mcp", {
          body: payload,
          headers: { "Content-Length": String(Buffer.byteLength(payload)) },
          method: "POST",
        }),
      }),
    );
    assert.deepEqual(
      registered.mock.calls.slice(start).map((call) => call.arguments[0]),
      [name],
      name,
    );
    await server.close();
  }
  assert.equal(getFeatureReadCount(), 12);
});

test("all feature-gated tools remain unavailable after configuration removal", async () => {
  const caller = user("targeted-feature-removal");
  configureFeatures(caller.id, { medallion: true, para: true, schemes: true });
  const configured = await rpc(caller, "tools/list");
  configureFeatures(caller.id, {});
  const plain = await rpc(caller, "tools/list");
  const basicNames = new Set(plain.result?.tools.map((tool) => tool.name));
  const gatedNames = configured.result?.tools
    .map((tool) => tool.name)
    .filter((name) => !basicNames.has(name));
  assert.equal(gatedNames?.length, 12);
  resetFeatureReadCount();
  for (const name of gatedNames ?? []) {
    const unavailable = await rpc(caller, "tools/call", {
      arguments: {},
      name,
    });
    assert.ok(unavailable.error, name);
    assert.match(unavailable.error.message, /not found/, name);
  }
  assert.equal(getFeatureReadCount(), 12);
  configureFeatures(caller.id, { para: true });
  const enabled = await rpc(caller, "tools/call", {
    arguments: { bucket: "invalid" },
    name: "para_list",
  });
  assert.equal(enabled.result?.isError, true);
  assert.match(enabled.result?.content[0].text ?? "", /Input validation error/);
  assert.equal(getFeatureReadCount(), 13);
});

test("unknown names and unknown/large body lengths retain the full registry", async (t) => {
  const caller = user("targeted-fallback");
  configureFeatures(caller.id, { medallion: true, para: true, schemes: true });
  const registered = t.mock.method(McpServer.prototype, "registerTool");
  const cases = [
    { length: "", name: "set_edit_lock" },
    { length: "2049", name: "set_edit_lock" },
    { name: "missing_tool" },
    { name: "__proto__" },
    { name: "toString" },
  ];
  resetFeatureReadCount();
  for (const { name, length } of cases) {
    const payload = JSON.stringify({
      id: 1,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: {}, name },
    });
    const input = new Request("https://md.example.invalid/mcp", {
      body: payload,
      headers: {
        "Content-Length": length ?? String(Buffer.byteLength(payload)),
      },
      method: "POST",
    });
    const start = registered.mock.calls.length;
    const server = await runAs(caller, () =>
      createMcpServerFactory({ era: "legacy", requestInfo: input }),
    );
    assert.equal(registered.mock.calls.length - start, 38);
    assert.equal(input.bodyUsed, false);
    await server.close();
  }
  assert.equal(getFeatureReadCount(), cases.length);
});

test("legacy spoofed name headers do not select a different tool or cause feature reads", async (t) => {
  t.mock.method(console, "log", () => undefined);
  resetFeatureReadCount();
  const result = await rpc(
    user("targeted-spoofed-name"),
    "tools/call",
    { arguments: { id: "note", locked: false }, name: "set_edit_lock" },
    { "Mcp-Method": "ping", "Mcp-Name": "para_list" },
  );
  assert.match(
    result.result?.content[0].text ?? "",
    /confirm=true is required/,
  );
  assert.equal(getFeatureReadCount(), 0);
});

test("modern calls preserve input validation, gates and encoded-name fallback", async () => {
  const caller = user("targeted-modern");
  configureFeatures(caller.id, { para: true });
  resetFeatureReadCount();
  for (const { name, args, headerName } of [
    { args: { limit: 0 }, name: "list_folder_entries" },
    { args: { bucket: "invalid" }, name: "para_list" },
    {
      args: { limit: 0 },
      headerName: "=?base64?bGlzdF9mb2xkZXJfZW50cmllcw==?=",
      name: "list_folder_entries",
    },
  ]) {
    const result = await rpc(
      caller,
      "tools/call",
      {
        _meta: {
          [CLIENT_CAPABILITIES_META_KEY]: {},
          [CLIENT_INFO_META_KEY]: { name: "test", version: "1" },
          [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
        },
        arguments: args,
        name,
      },
      {
        "MCP-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": headerName ?? name,
      },
    );
    assert.equal(result.result?.isError, true);
    assert.match(
      result.result?.content[0].text ?? "",
      /Input validation error/,
    );
  }
  assert.equal(getFeatureReadCount(), 2);
});

test("modern mismatched tool names are rejected before feature reads or dispatch", async () => {
  const payload = JSON.stringify({
    id: 1,
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      _meta: {
        [CLIENT_CAPABILITIES_META_KEY]: {},
        [CLIENT_INFO_META_KEY]: { name: "test", version: "1" },
        [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
      },
      arguments: {},
      name: "para_list",
    },
  });
  resetFeatureReadCount();
  const response = await runAs(user("targeted-modern-spoof"), () =>
    handler.fetch(
      new Request("https://md.example.invalid/mcp", {
        body: payload,
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "tools/call",
          "Mcp-Name": "get_note",
        },
        method: "POST",
      }),
    ),
  );
  assert.equal(response.status, 400);
  assert.match(await response.text(), /Mcp-Name/);
  assert.equal(getFeatureReadCount(), 0);
});

test("tool lists follow each user's current configuration, including concurrent requests", async () => {
  const configured = user("configured");
  const plain = user("plain");
  configureFeatures(configured.id, {
    medallion: true,
    para: true,
    schemes: true,
  });
  const [a, b] = await Promise.all([
    rpc(configured, "tools/list"),
    rpc(plain, "tools/list"),
  ]);
  assert.ok(a.result);
  assert.ok(b.result);
  assert.equal(a.result.tools.length, 38);
  assert.equal(b.result.tools.length, 26);
  assert.ok(a.result.tools.some((tool) => tool.name === "para_list"));
  assert.ok(!b.result.tools.some((tool) => tool.name === "para_list"));
  configureFeatures(configured.id, {});
  const updated = await rpc(configured, "tools/list");
  assert.ok(updated.result);
  assert.equal(updated.result.tools.length, 26);
  const first = await runAs(configured, createMcpServerFactory);
  const second = await runAs(plain, createMcpServerFactory);
  assert.notEqual(first, second);
  await Promise.all([first.close(), second.close()]);
});

test("shared definitions keep SDK input validation and feature-gated dispatch", async () => {
  const caller = user("validation");
  const invalid = await rpc(caller, "tools/call", {
    arguments: { limit: 0 },
    name: "list_folder_entries",
  });
  assert.ok(invalid.result);
  assert.equal(invalid.result.isError, true);
  assert.match(invalid.result.content[0].text, /Input validation error/);
  const unavailable = await rpc(caller, "tools/call", {
    arguments: {},
    name: "para_list",
  });
  assert.ok(unavailable.error);
  assert.match(unavailable.error.message, /not found/);
});

test("tool handlers read the current request's auth context", async (t) => {
  t.mock.method(console, "log", () => undefined);
  const params = {
    arguments: { id: "note", locked: false },
    name: "set_edit_lock",
  };
  const [authenticated, unauthenticated] = await Promise.all([
    rpc(user("authenticated"), "tools/call", params),
    rpc(null, "tools/call", params),
  ]);
  assert.ok(authenticated.result);
  assert.ok(unauthenticated.result);
  assert.match(
    authenticated.result.content[0].text,
    /confirm=true is required/,
  );
  assert.equal(unauthenticated.result.content[0].text, "Unauthorized");
});

test("bootstrap capabilities stay unchanged without feature reads; tool lists still read current settings", async () => {
  const caller = user("bootstrap");
  configureFeatures(caller.id, { medallion: true, para: true, schemes: true });
  resetFeatureReadCount();
  const initialized = await rpc(caller, "initialize", {
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
    protocolVersion: "2025-06-18",
  });
  assert.deepEqual(initialized.result?.capabilities, {
    tools: { listChanged: true },
  });
  assert.equal(getFeatureReadCount(), 0);
  const pong = await rpc(caller, "ping");
  assert.deepEqual(pong.result, {});
  assert.equal(getFeatureReadCount(), 0);

  const payload = JSON.stringify({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  const notification = await runAs(caller, () =>
    handler.fetch(
      new Request("https://md.example.invalid/mcp", {
        body: payload,
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Length": String(Buffer.byteLength(payload)),
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2025-06-18",
        },
        method: "POST",
      }),
    ),
  );
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), "");
  assert.equal(getFeatureReadCount(), 0);

  configureFeatures(caller.id, {});
  const plain = await rpc(caller, "tools/list");
  assert.equal(plain.result?.tools.length, 26);
  configureFeatures(caller.id, { medallion: true, para: true, schemes: true });
  const enabled = await rpc(caller, "tools/list");
  assert.equal(enabled.result?.tools.length, 38);
  assert.equal(getFeatureReadCount(), 2);
});

test("bootstrap classification never replaces SDK protocol validation", async () => {
  const invalid = await rpc(user("invalid-bootstrap"), "initialize", {
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
    protocolVersion: 123,
  });
  assert.ok(invalid.error);
  assert.equal(invalid.result, undefined);
});

test("legacy tool calls cannot bypass feature gates with a bootstrap method header", async () => {
  const payload = JSON.stringify({
    id: 1,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: {}, name: "para_list" },
  });
  resetFeatureReadCount();
  const response = await runAs(user("spoofed-bootstrap"), () =>
    handler.fetch(
      new Request("https://md.example.invalid/mcp", {
        body: payload,
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Length": String(Buffer.byteLength(payload)),
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2025-06-18",
          "Mcp-Method": "initialize",
        },
        method: "POST",
      }),
    ),
  );
  const body = await response.text();
  assert.match(body, /not found/);
  assert.equal(getFeatureReadCount(), 1);
});

test("modern mismatched method headers are rejected by the SDK before dispatch", async () => {
  const payload = JSON.stringify({
    id: 1,
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      _meta: {
        [CLIENT_CAPABILITIES_META_KEY]: {},
        [CLIENT_INFO_META_KEY]: { name: "test", version: "1" },
        [PROTOCOL_VERSION_META_KEY]: "2026-07-28",
      },
      arguments: {},
      name: "para_list",
    },
  });
  resetFeatureReadCount();
  const response = await runAs(user("modern-bootstrap"), () =>
    handler.fetch(
      new Request("https://md.example.invalid/mcp", {
        body: payload,
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2026-07-28",
          "Mcp-Method": "ping",
          "Mcp-Name": "para_list",
        },
        method: "POST",
      }),
    ),
  );
  assert.equal(response.status, 400);
  assert.match(await response.text(), /Mcp-Method/);
  assert.equal(getFeatureReadCount(), 0);
});

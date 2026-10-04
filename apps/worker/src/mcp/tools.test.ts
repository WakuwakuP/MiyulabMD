import assert from "node:assert/strict";
import { test } from "node:test";
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
} from "../../scripts/mcp-test-runtime.mjs";

setupMcpTestRuntime();
const { createMcpServerFactory } = await import("./tools.ts");
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

function rpc(user: User | null, method: string, params = {}) {
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

import assert from "node:assert/strict";
import { test } from "node:test";
import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  configureFeatures,
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
    content: { text: string }[];
    isError?: boolean;
    tools: { name: string }[];
  };
};

function rpc(user: User | null, method: string, params = {}) {
  return runAs(user, async () => {
    const response = await handler.fetch(
      new Request("https://md.example.invalid/mcp", {
        body: JSON.stringify({ id: 1, jsonrpc: "2.0", method, params }),
        headers: {
          Accept: "application/json, text/event-stream",
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

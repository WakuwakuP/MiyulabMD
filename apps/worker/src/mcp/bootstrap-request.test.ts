import assert from "node:assert/strict";
import { test } from "node:test";
import { isBootstrapRequest } from "./bootstrap-request.ts";

function request(body: string, headers: Record<string, string> = {}) {
  return new Request("https://md.example.invalid/mcp", {
    body,
    headers: { "Content-Length": String(Buffer.byteLength(body)), ...headers },
    method: "POST",
  });
}

test("only small known legacy bootstrap messages skip registration, without consuming the body", async () => {
  for (const method of ["initialize", "notifications/initialized", "ping"]) {
    const body = JSON.stringify({ jsonrpc: "2.0", method });
    const input = request(body);
    assert.equal(
      await isBootstrapRequest({ era: "legacy", requestInfo: input }),
      true,
    );
    assert.equal(input.bodyUsed, false);
    assert.equal(await input.text(), body);
  }
  for (const body of [
    "{",
    "null",
    "[]",
    '{"method":"ping"}',
    JSON.stringify({ jsonrpc: "2.0", method: "tools/list" }),
    JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "para_list" },
    }),
  ]) {
    const input = request(body, { "Mcp-Method": "ping" });
    assert.equal(
      await isBootstrapRequest({ era: "legacy", requestInfo: input }),
      false,
    );
    assert.equal(input.bodyUsed, false);
  }
});

test("missing/invalid lengths and large bodies retain the full factory", async () => {
  assert.equal(await isBootstrapRequest(), false);
  assert.equal(await isBootstrapRequest({ era: "legacy" }), false);
  const body = JSON.stringify({ jsonrpc: "2.0", method: "ping" });
  for (const length of ["", "-1", "NaN", "2049"]) {
    const input = request(body, { "Content-Length": length });
    assert.equal(
      await isBootstrapRequest({ era: "legacy", requestInfo: input }),
      false,
    );
    assert.equal(input.bodyUsed, false);
  }
});

test("modern ping uses the SDK-validated method header, not an already-consumed body", async () => {
  for (const method of ["ping", "tools/call", "server/discover", ""]) {
    const input = request("{}", { "Mcp-Method": method });
    await input.text();
    assert.equal(
      await isBootstrapRequest({ era: "modern", requestInfo: input }),
      method === "ping",
    );
  }
});

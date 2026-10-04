import assert from "node:assert/strict";
import { test } from "node:test";
import { getMcpRequestTarget } from "./request-target.ts";

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
    assert.deepEqual(
      await getMcpRequestTarget({ era: "legacy", requestInfo: input }),
      { kind: "bootstrap" },
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
  ]) {
    const input = request(body, { "Mcp-Method": "ping" });
    assert.equal(
      await getMcpRequestTarget({ era: "legacy", requestInfo: input }),
      null,
    );
    assert.equal(input.bodyUsed, false);
  }
});

test("missing/invalid lengths and large bodies retain the full factory", async () => {
  assert.equal(await getMcpRequestTarget(), null);
  assert.equal(await getMcpRequestTarget({ era: "legacy" }), null);
  const body = JSON.stringify({ jsonrpc: "2.0", method: "ping" });
  for (const length of ["", "-1", "NaN", "2049"]) {
    const input = request(body, { "Content-Length": length });
    assert.equal(
      await getMcpRequestTarget({ era: "legacy", requestInfo: input }),
      null,
    );
    assert.equal(input.bodyUsed, false);
  }
});

test("modern ping uses the SDK-validated method header, not an already-consumed body", async () => {
  for (const method of ["ping", "tools/call", "server/discover", ""]) {
    const input = request("{}", { "Mcp-Method": method });
    await input.text();
    assert.deepEqual(
      await getMcpRequestTarget({ era: "modern", requestInfo: input }),
      method === "ping" ? { kind: "bootstrap" } : null,
    );
  }
});

test("legacy calls use the body name, ignoring routing headers and preserving the original body", async () => {
  const body = JSON.stringify({
    id: 1,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: {}, name: "get_note" },
  });
  const input = request(body, {
    "Mcp-Method": "ping",
    "Mcp-Name": "para_list",
  });
  assert.deepEqual(
    await getMcpRequestTarget({ era: "legacy", requestInfo: input }),
    { kind: "tool", name: "get_note" },
  );
  assert.equal(await input.text(), body);
  for (const params of [null, [], {}, { name: 1 }]) {
    const invalid = request(
      JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params }),
    );
    assert.equal(
      await getMcpRequestTarget({ era: "legacy", requestInfo: invalid }),
      null,
    );
    assert.equal(invalid.bodyUsed, false);
  }
});

test("modern calls use SDK-validated headers without reading the consumed body", async () => {
  const input = request("{}", {
    "Mcp-Method": "tools/call",
    "Mcp-Name": "get_note",
  });
  await input.text();
  assert.deepEqual(
    await getMcpRequestTarget({ era: "modern", requestInfo: input }),
    { kind: "tool", name: "get_note" },
  );
});

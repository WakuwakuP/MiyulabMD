import assert from "node:assert/strict";
import { test } from "node:test";
import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  configureFeatures,
  runAs,
  setupMcpTestRuntime,
} from "../../scripts/mcp-test-runtime.mjs";
import {
  decideFastMcp,
  type McpFeatureFlags,
  toolsListResponse,
} from "./protocol-fast-path.ts";

setupMcpTestRuntime();
const { createMcpServerFactory } = await import("./tools.ts");
const handler = createMcpHandler(createMcpServerFactory);

const caller = {
  displayName: "fast",
  email: "fast@example.invalid",
  id: "fast-path",
};

const flagsOff: McpFeatureFlags = {
  hasMedallion: false,
  hasPara: false,
  hasSchemes: false,
};
const flagsOn: McpFeatureFlags = {
  hasMedallion: true,
  hasPara: true,
  hasSchemes: true,
};

function headers(extra: Record<string, string> = {}) {
  return new Headers({
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-11-25",
    ...extra,
  });
}

function message(method: string, params?: unknown, id?: number) {
  return JSON.stringify({
    jsonrpc: "2.0",
    method,
    ...(params === undefined ? {} : { params }),
    ...(id === undefined ? {} : { id }),
  });
}

function dataLine(body: string) {
  const line = body.split("\n").find((item) => item.startsWith("data: "));
  assert.ok(line);
  return JSON.parse(line.slice("data: ".length)) as {
    result?: { protocolVersion?: string; tools?: { name: string }[] };
  };
}

async function sdk(method: string, params?: unknown, id = 1) {
  const payload = JSON.stringify({ id, jsonrpc: "2.0", method, params });
  const response = await runAs(caller, () =>
    handler.fetch(
      new Request("https://md.example.invalid/mcp", {
        body: payload,
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Length": String(Buffer.byteLength(payload)),
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2025-11-25",
        },
        method: "POST",
      }),
    ),
  );
  return { body: await response.text(), status: response.status };
}

test("fast path matches the SDK initialize, ping, and notification responses", async () => {
  for (const protocolVersion of ["2025-11-25", "2024-10-07", "1999-01-01"]) {
    const params = {
      capabilities: {},
      clientInfo: { name: "Cursor", version: "1" },
      protocolVersion,
    };
    const live = await sdk("initialize", params);
    const decision = decideFastMcp(message("initialize", params, 1), headers());
    assert.equal(decision.kind, "response");
    if (decision.kind !== "response") {
      return;
    }
    assert.equal(decision.response.status, live.status);
    assert.deepEqual(
      dataLine(await decision.response.text()).result,
      dataLine(live.body).result,
    );
  }

  const pong = await sdk("ping", {});
  const ping = decideFastMcp(message("ping", {}, 1), headers());
  assert.equal(ping.kind, "response");
  if (ping.kind === "response") {
    assert.deepEqual(dataLine(await ping.response.text()), dataLine(pong.body));
  }

  const payload = message("notifications/initialized");
  const liveNotification = await runAs(caller, () =>
    handler.fetch(
      new Request("https://md.example.invalid/mcp", {
        body: payload,
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Length": String(Buffer.byteLength(payload)),
          "Content-Type": "application/json",
          "MCP-Protocol-Version": "2025-11-25",
        },
        method: "POST",
      }),
    ),
  );
  const notification = decideFastMcp(payload, headers());
  assert.equal(notification.kind, "response");
  if (notification.kind === "response") {
    assert.equal(notification.response.status, liveNotification.status);
    assert.equal(await notification.response.text(), "");
    assert.equal(
      notification.response.headers.get("access-control-allow-origin"),
      "*",
    );
  }
});

test("invalid initialize and modern requests stay on the SDK", () => {
  const invalid = decideFastMcp(
    message("initialize", { protocolVersion: 123 }, 1),
    headers(),
  );
  assert.equal(invalid.kind, "passthrough");
  const modern = decideFastMcp(
    message(
      "initialize",
      {
        capabilities: {},
        clientInfo: { name: "Cursor", version: "1" },
        protocolVersion: "2026-07-28",
      },
      1,
    ),
    headers({ "MCP-Protocol-Version": "2026-07-28" }),
  );
  assert.equal(modern.kind, "passthrough");

  const bodyOnly = decideFastMcp(
    message(
      "initialize",
      {
        capabilities: {},
        clientInfo: { name: "Cursor", version: "1" },
        protocolVersion: "2026-07-28",
      },
      1,
    ),
    new Headers({
      Accept: "application/json, text/event-stream",
    }),
  );
  assert.equal(bodyOnly.kind, "passthrough");

  const enveloped = decideFastMcp(
    message(
      "tools/list",
      {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        },
      },
      1,
    ),
    headers(),
  );
  assert.equal(enveloped.kind, "passthrough");
});

test("client notifications are accepted without the SDK", () => {
  const cancelled = decideFastMcp(
    message("notifications/cancelled", { reason: "stop", requestId: 4 }),
    headers(),
  );
  assert.equal(cancelled.kind, "response");
  if (cancelled.kind === "response") {
    assert.equal(cancelled.response.status, 202);
  }
  const progress = decideFastMcp(
    message("notifications/progress", { progress: 1, progressToken: "token" }),
    headers(),
  );
  assert.equal(progress.kind, "response");
  if (progress.kind === "response") {
    assert.equal(progress.response.status, 202);
  }
  assert.equal(
    decideFastMcp(message("notifications/progress", {}), headers()).kind,
    "passthrough",
  );
});

test("fast path rejects a missing accept header and an unknown protocol header", async () => {
  const missing = decideFastMcp(
    message("ping", {}, 1),
    new Headers({ "Content-Type": "application/json" }),
  );
  assert.equal(missing.kind, "response");
  if (missing.kind === "response") {
    assert.equal(missing.response.status, 406);
  }
  const unknown = decideFastMcp(
    message("ping", {}, 1),
    headers({ "MCP-Protocol-Version": "1999-01-01" }),
  );
  assert.equal(unknown.kind, "response");
  if (unknown.kind === "response") {
    assert.equal(unknown.response.status, 400);
    assert.match(await unknown.response.text(), /1999-01-01/);
  }
});

test("tools/list matches the SDK registry for both feature sets", async () => {
  configureFeatures(caller.id, {});
  const plainSdk = await sdk("tools/list", {});
  const plain = decideFastMcp(message("tools/list", {}, 1), headers());
  assert.equal(plain.kind, "tools-list");
  if (plain.kind !== "tools-list") {
    return;
  }
  const plainFast = toolsListResponse(plain.id, flagsOff);
  assert.deepEqual(
    dataLine(await plainFast.text()).result?.tools,
    dataLine(plainSdk.body).result?.tools,
  );

  configureFeatures(caller.id, { medallion: true, para: true, schemes: true });
  const enabledSdk = await sdk("tools/list", {});
  const enabled = toolsListResponse(1, flagsOn);
  assert.deepEqual(
    dataLine(await enabled.text()).result?.tools,
    dataLine(enabledSdk.body).result?.tools,
  );
});

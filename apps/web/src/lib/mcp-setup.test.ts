import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MCP_AGENT_IDS,
  mcpAgentGuide,
  mcpAuthorizationHeader,
  mcpClaudeCodeCommand,
  mcpClaudeCodeConfig,
  mcpClaudeDesktopConfig,
  mcpCodexConfig,
  mcpCursorConfig,
  mcpEndpointUrl,
  mcpVsCodeConfig,
  mcpWindsurfConfig,
} from "./mcp-setup.ts";

const origin = "https://md.example.com";
const token = "secret";

test("mcpEndpointUrl joins origin and /mcp without a double slash", () => {
  assert.equal(mcpEndpointUrl(origin), "https://md.example.com/mcp");
  assert.equal(mcpEndpointUrl(`${origin}/`), "https://md.example.com/mcp");
});

test("mcpAuthorizationHeader prefixes Bearer", () => {
  assert.equal(mcpAuthorizationHeader(token), "Bearer secret");
});

test("mcpCursorConfig is Cursor mcp.json with url and Authorization", () => {
  const parsed = JSON.parse(mcpCursorConfig(origin, token)) as {
    mcpServers: {
      miyulabmd: { url: string; headers: { Authorization: string } };
    };
  };
  assert.equal(parsed.mcpServers.miyulabmd.url, "https://md.example.com/mcp");
  assert.equal(
    parsed.mcpServers.miyulabmd.headers.Authorization,
    "Bearer secret",
  );
});

test("mcpClaudeCodeCommand uses http transport and Authorization header", () => {
  const command = mcpClaudeCodeCommand(origin, token);
  assert.match(command, /claude mcp add --transport http miyulabmd/);
  assert.match(command, /https:\/\/md\.example\.com\/mcp/);
  assert.match(command, /--header "Authorization: Bearer secret"/);
});

test("mcpClaudeCodeConfig requires type http", () => {
  const parsed = JSON.parse(mcpClaudeCodeConfig(origin, token)) as {
    mcpServers: {
      miyulabmd: { type: string; url: string };
    };
  };
  assert.equal(parsed.mcpServers.miyulabmd.type, "http");
  assert.equal(parsed.mcpServers.miyulabmd.url, "https://md.example.com/mcp");
});

test("mcpClaudeDesktopConfig bridges remote HTTP with mcp-remote", () => {
  const parsed = JSON.parse(mcpClaudeDesktopConfig(origin, token)) as {
    mcpServers: {
      miyulabmd: {
        command: string;
        args: string[];
        env: { AUTH_HEADER: string };
      };
    };
  };
  assert.equal(parsed.mcpServers.miyulabmd.command, "npx");
  assert.ok(parsed.mcpServers.miyulabmd.args.includes("mcp-remote"));
  assert.ok(
    parsed.mcpServers.miyulabmd.args.includes("https://md.example.com/mcp"),
  );
  assert.equal(parsed.mcpServers.miyulabmd.env.AUTH_HEADER, "Bearer secret");
});

test("mcpVsCodeConfig uses servers instead of mcpServers", () => {
  const parsed = JSON.parse(mcpVsCodeConfig(origin, token)) as {
    servers: { miyulabmd: { type: string; url: string } };
  };
  assert.equal(parsed.servers.miyulabmd.type, "http");
  assert.equal(parsed.servers.miyulabmd.url, "https://md.example.com/mcp");
});

test("mcpCodexConfig writes TOML url and Authorization header", () => {
  const toml = mcpCodexConfig(origin, token);
  assert.match(toml, /\[mcp_servers\.miyulabmd\]/);
  assert.match(toml, /url = "https:\/\/md\.example\.com\/mcp"/);
  assert.match(toml, /Authorization = "Bearer secret"/);
});

test("mcpWindsurfConfig uses serverUrl instead of url", () => {
  const parsed = JSON.parse(mcpWindsurfConfig(origin, token)) as {
    mcpServers: {
      miyulabmd: { serverUrl: string; headers: { Authorization: string } };
    };
  };
  assert.equal(
    parsed.mcpServers.miyulabmd.serverUrl,
    "https://md.example.com/mcp",
  );
  assert.equal(
    parsed.mcpServers.miyulabmd.headers.Authorization,
    "Bearer secret",
  );
});

test("mcpAgentGuide covers every client with endpoint and token", () => {
  for (const id of MCP_AGENT_IDS) {
    const guide = mcpAgentGuide(id, origin, token);
    assert.equal(guide.id, id);
    assert.ok(guide.snippets.length > 0);
    assert.ok(guide.snippets.some((snippet) => snippet.value.includes(origin)));
    assert.ok(guide.snippets.some((snippet) => snippet.value.includes(token)));
  }
});

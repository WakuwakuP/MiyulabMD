import assert from "node:assert/strict";
import { test } from "node:test";

import { MCP_NOTE_URL_HINT, MCP_TOOLS } from "./mcp.ts";

test("MCP_TOOLS includes history tools", () => {
  assert.ok(MCP_TOOLS.includes("list_note_history"));
  assert.ok(MCP_TOOLS.includes("get_revision"));
  assert.ok(MCP_TOOLS.includes("restore_revision"));
});

test("MCP_TOOLS includes single empty-folder deletion", () => {
  assert.ok(MCP_TOOLS.includes("delete_folder"));
  assert.equal(MCP_TOOLS.filter((name) => name === "delete_folder").length, 1);
});

test("MCP_NOTE_URL_HINT teaches /n/{id} and rejects /{shortId}", () => {
  assert.ok(MCP_NOTE_URL_HINT.includes("/n/{id}"));
  assert.ok(MCP_NOTE_URL_HINT.includes("Do not use /{shortId}"));
});

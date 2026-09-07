import assert from "node:assert/strict";
import { test } from "node:test";

import { MCP_TOOLS } from "./mcp.ts";

test("MCP_TOOLS includes history tools", () => {
  assert.ok(MCP_TOOLS.includes("list_note_history"));
  assert.ok(MCP_TOOLS.includes("get_revision"));
  assert.ok(MCP_TOOLS.includes("restore_revision"));
});

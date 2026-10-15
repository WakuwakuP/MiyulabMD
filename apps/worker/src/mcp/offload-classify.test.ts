import assert from "node:assert/strict";
import { test } from "node:test";

import { offloadToolName } from "./offload-classify.ts";

function headers(extra: Record<string, string> = {}) {
  return new Headers(extra);
}

const call = JSON.stringify({
  id: 1,
  jsonrpc: "2.0",
  method: "tools/call",
  params: { arguments: { query: "USB" }, name: "list_notes" },
});

test("offload accepts the measured read tools and leaves everything else", () => {
  assert.equal(offloadToolName(call, headers()), "list_notes");
  const grep = call.replace("list_notes", "grep_notes");
  assert.equal(offloadToolName(grep, headers()), "grep_notes");
  const search = call.replace("list_notes", "search_notes");
  assert.equal(offloadToolName(search, headers()), "search_notes");
  const entries = call.replace("list_notes", "list_folder_entries");
  assert.equal(offloadToolName(entries, headers()), "list_folder_entries");
  const getNote = call.replace("list_notes", "get_note");
  assert.equal(offloadToolName(getNote, headers()), null);
});

test("offload refuses a mismatched modern tool name", () => {
  assert.equal(
    offloadToolName(call, headers({ "Mcp-Name": "get_note" })),
    null,
  );
  assert.equal(
    offloadToolName(
      call,
      headers({ "Mcp-Method": "tools/call", "Mcp-Name": "list_notes" }),
    ),
    "list_notes",
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";
import { applyTextDiff, inspectPlainTextDelta } from "./y-text-diff.ts";

test("applyTextDiff inserts a character without rewriting the rest", () => {
  const doc = new Y.Doc();
  const text = doc.getText("markdown");
  text.insert(0, "# 無題\n\nhello");

  const ops: Array<{ insert?: string; delete?: number }> = [];
  text.observe((event) => {
    for (const item of event.delta) {
      ops.push(item);
    }
  });

  applyTextDiff(text, "# 無題\n\nhello!");
  assert.equal(text.toString(), "# 無題\n\nhello!");
  assert.deepEqual(ops, [{ retain: 11 }, { insert: "!" }]);
});

test("applyTextDiff deletes without replacing the whole document", () => {
  const doc = new Y.Doc();
  const text = doc.getText("markdown");
  text.insert(0, "abcde");

  const ops: Array<{ insert?: string; delete?: number; retain?: number }> = [];
  text.observe((event) => {
    for (const item of event.delta) ops.push(item);
  });

  applyTextDiff(text, "abde");
  assert.equal(text.toString(), "abde");
  assert.deepEqual(ops, [{ retain: 2 }, { delete: 1 }]);
});

test("inspectPlainTextDelta accepts a single insert of letters", () => {
  assert.deepEqual(inspectPlainTextDelta([{ retain: 4 }, { insert: "x" }]), {
    kind: "insert",
    index: 4,
    text: "x",
  });
});

test("inspectPlainTextDelta rejects markdown syntax inserts", () => {
  assert.equal(inspectPlainTextDelta([{ retain: 1 }, { insert: "**" }]), null);
  assert.equal(inspectPlainTextDelta([{ insert: "a" }, { insert: "b" }]), null);
});

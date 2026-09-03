import assert from "node:assert/strict";
import { test } from "node:test";
import * as Y from "yjs";

import {
  applyTextDiff,
  excerptAround,
  markdownOutline,
  numberMarkdownLines,
  planInsert,
  planReplace,
} from "./markdown-edit.ts";

test("planReplace replaces a unique string and places the cursor on the new text", () => {
  const plan = planReplace("# Title\n\nhello world", "hello", "こんにちは");
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.next, "# Title\n\nこんにちは world");
  assert.deepEqual(plan.cursor, { anchor: 9, head: 14 });
});

test("planReplace fails when the string is missing or ambiguous", () => {
  const missing = planReplace("abc", "z", "Z");
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.error, "not_found");

  const ambiguous = planReplace("foo foo", "foo", "bar");
  assert.equal(ambiguous.ok, false);
  if (ambiguous.ok) return;
  assert.equal(ambiguous.error, "ambiguous");
  assert.equal(ambiguous.matches, 2);
});

test("planReplace replaceAll updates every non-overlapping match", () => {
  const plan = planReplace("foo foo foo", "foo", "bar", true);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.next, "bar bar bar");
  assert.deepEqual(plan.cursor, { anchor: 8, head: 11 });
});

test("planInsert after unique context", () => {
  const plan = planInsert("# Title\n\nbody", "\n\nmore", { after: "# Title" });
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.next, "# Title\n\nmore\n\nbody");
  assert.deepEqual(plan.cursor, { anchor: 7, head: 13 });
});

test("planInsert before / start / end", () => {
  assert.deepEqual(planInsert("ab", "X", { at: "start" }), {
    ok: true,
    next: "Xab",
    cursor: { anchor: 0, head: 1 },
  });
  assert.deepEqual(planInsert("ab", "X", { at: "end" }), {
    ok: true,
    next: "abX",
    cursor: { anchor: 2, head: 3 },
  });
  const before = planInsert("hello world", "X", { before: "world" });
  assert.equal(before.ok, true);
  if (!before.ok) return;
  assert.equal(before.next, "hello Xworld");
});

test("applyTextDiff inserts without rewriting the rest", () => {
  const doc = new Y.Doc();
  const text = doc.getText("markdown");
  text.insert(0, "# 無題\n\nhello");

  const ops: Array<{ insert?: string; delete?: number; retain?: number }> = [];
  text.observe((event) => {
    for (const item of event.delta) ops.push(item);
  });

  applyTextDiff(text, "# 無題\n\nhello!");
  assert.equal(text.toString(), "# 無題\n\nhello!");
  assert.deepEqual(ops, [{ retain: 11 }, { insert: "!" }]);
  doc.destroy();
});

test("excerptAround and outline helpers", () => {
  const markdown = "# One\n\nhello\n\n## Two\n";
  assert.deepEqual(markdownOutline(markdown), [
    { level: 1, text: "One", line: 1 },
    { level: 2, text: "Two", line: 5 },
  ]);
  assert.equal(excerptAround("abcdefghij", 4, 6, 1), "…defg…");
  assert.equal(numberMarkdownLines("a\nb"), "1|a\n2|b");
});

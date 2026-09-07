import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatHistoryOp,
  formatHistoryRange,
  formatHistoryWhen,
} from "./note-history.ts";

test("formatHistoryOp labels recorded ops", () => {
  assert.equal(formatHistoryOp("insert"), "挿入");
  assert.equal(formatHistoryOp("delete"), "削除");
  assert.equal(formatHistoryOp("replace"), "置換");
  assert.equal(formatHistoryOp("restore"), "復元");
});

test("formatHistoryRange describes a character span", () => {
  assert.equal(formatHistoryRange(9, 14), "9–14 文字");
  assert.equal(formatHistoryRange(4, 4), "4 文字目");
});

test("formatHistoryWhen uses a Japanese date time", () => {
  const text = formatHistoryWhen(new Date(2026, 8, 6, 12, 0, 0).getTime());
  assert.match(text, /2026/);
  assert.match(text, /9/);
});

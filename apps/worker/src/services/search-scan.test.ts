import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLineMatcher,
  GREP_LIMITS,
  grepRows,
  type LineMatcher,
} from "./search.ts";

const row = (markdown: string | null) => ({
  id: "note",
  markdown_snapshot: markdown,
  snapshot_updated_at: 123,
  title: "Note",
});

function compareSnapshot(markdown: string, matcher: LineMatcher) {
  const original = { match: matcher.match };
  for (const maxMatchesPerNote of [0, 1, 2, 50]) {
    for (const context of [0, 1, 5]) {
      const options = {
        contextAfter: context,
        contextBefore: context,
        deadlineMs: 60_000,
        maxMatchesPerNote,
      };
      assert.deepEqual(
        grepRows([row(markdown)], matcher, options),
        grepRows([row(markdown)], original, options),
        JSON.stringify({ context, markdown, maxMatchesPerNote }),
      );
    }
  }
}

test("indexed fixed-string scan agrees with the original per-line matcher", () => {
  const snapshots = [
    "",
    "\n",
    "\n\n",
    "needle",
    "Needle\n",
    "\nneedle\n\n",
    "needle needle\nordinary\nNEEDLE\n",
    "first\r\nNeedle\r\nlast\r\n",
    "😀NEEDLE\n金曜日の予定\nneedle\n",
    "İ before NEEDLE\nİneedle\n",
    "ΟΣ\nΟΣ Α\nος\n",
    "a\u0000needle\n",
    "one\ntwo\nneedle\nthree\nfour\nfive\n",
  ];
  const fragments = [
    "ordinary",
    "NEEDLE",
    "",
    "😀needle",
    "İneedle",
    "金曜日",
    "ΟΣ",
  ];
  let seed = 42;
  for (let n = 0; n < 40; n++) {
    const lines = Array.from({ length: 20 }, () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return fragments[seed % fragments.length];
    });
    snapshots.push(lines.join(n % 2 ? "\r\n" : "\n"));
  }
  for (const pattern of [
    "needle",
    "金曜日",
    "ος",
    "ΟΣ",
    "İ",
    "one\ntwo",
    "\n",
    "\u0000",
  ]) {
    for (const caseSensitive of [false, true]) {
      const created = createLineMatcher(pattern, { caseSensitive });
      assert.ok(created.kind === "ok");
      // Omitting the optional index hook exercises the retained original
      // split/per-line path, with identical limits, budgets and truncation.
      for (const markdown of snapshots) {
        compareSnapshot(markdown, created.matcher);
      }
    }
  }
});

test("regex remains line-relative, including empty final lines and zero-length hits", () => {
  for (const pattern of ["^needle", "^$", "$", "n.*e"]) {
    const created = createLineMatcher(pattern, { fixedString: false });
    assert.ok(created.kind === "ok");
    assert.equal(created.matcher.prepareSnapshot, undefined);
    const result = grepRows([row("first\nneedle\n")], created.matcher);
    if (pattern === "^needle") {
      assert.equal(result.matches[0]?.line, 2);
    }
    if (pattern === "^$") {
      assert.equal(result.matches[0]?.line, 3);
    }
    if (pattern === "$") {
      assert.equal(result.matches.length, 3);
    }
  }
});

test("indexed scans preserve scanned-note/character/match budgets and null snapshots", () => {
  const created = createLineMatcher("needle");
  assert.ok(created.kind === "ok");
  const original = { match: created.matcher.match };
  const workloads = [
    [row(null), row("needle"), row("ordinary")],
    [row("x".repeat(GREP_LIMITS.maxScanChars + 1)), row("needle")],
    Array.from({ length: GREP_LIMITS.maxScanNotes + 1 }, () => row("ordinary")),
    [row("needle"), row("needle"), row("ordinary")],
  ];
  for (const rows of workloads) {
    for (const maxNotes of [1, 50, 200]) {
      const options = { deadlineMs: 60_000, maxNotes };
      assert.deepEqual(
        grepRows(rows, created.matcher, options),
        grepRows(rows, original, options),
      );
    }
  }
});

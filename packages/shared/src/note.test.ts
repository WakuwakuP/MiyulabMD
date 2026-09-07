import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isNoteEditOp,
  isNoteHistoryActorKind,
  NOTE_EDIT_OPS,
  NOTE_HISTORY_ACTOR_KINDS,
  NOTE_RESTORE_MESSAGE,
} from "./note.ts";

test("isNoteHistoryActorKind accepts recorded actor kinds", () => {
  for (const kind of NOTE_HISTORY_ACTOR_KINDS) {
    assert.equal(isNoteHistoryActorKind(kind), true);
  }
  assert.equal(isNoteHistoryActorKind("owner"), false);
});

test("NOTE_RESTORE_MESSAGE mentions concurrent overwrite", () => {
  assert.match(NOTE_RESTORE_MESSAGE, /同時/);
  assert.match(NOTE_RESTORE_MESSAGE, /上書き/);
});

test("isNoteEditOp accepts recorded edit ops", () => {
  for (const op of NOTE_EDIT_OPS) {
    assert.equal(isNoteEditOp(op), true);
  }
  assert.equal(isNoteEditOp("update"), false);
});

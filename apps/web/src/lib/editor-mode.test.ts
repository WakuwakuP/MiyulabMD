import assert from "node:assert/strict";
import { test } from "node:test";
import { isEditMode, isEditorMode } from "./editor-mode.ts";

test("isEditMode is only split, source, and rich", () => {
  assert.equal(isEditMode("split"), true);
  assert.equal(isEditMode("source"), true);
  assert.equal(isEditMode("rich"), true);
  assert.equal(isEditMode("preview"), false);
});

test("isEditorMode includes preview", () => {
  assert.equal(isEditorMode("preview"), true);
  assert.equal(isEditorMode("unknown"), false);
});

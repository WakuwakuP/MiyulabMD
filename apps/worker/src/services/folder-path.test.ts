import assert from "node:assert/strict";
import { test } from "node:test";
import { rewriteFolderPrefix } from "@miyulabmd/shared";

test("rewriteFolderPrefix remaps a folder and its descendants", () => {
  assert.equal(rewriteFolderPrefix("work", "work", "play"), "play");
  assert.equal(rewriteFolderPrefix("work/infra", "work", "play"), "play/infra");
  assert.equal(
    rewriteFolderPrefix("work/infra/db", "work/infra", "ops"),
    "ops/db",
  );
});

test("rewriteFolderPrefix ignores folders outside the source path", () => {
  assert.equal(rewriteFolderPrefix("play", "work", "play"), null);
  assert.equal(rewriteFolderPrefix("workplace", "work", "play"), null);
  assert.equal(rewriteFolderPrefix("work", "", "play"), null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { colorForEmail, initialFromName } from "./user-style.ts";

test("colorForEmail is deterministic for the same address", () => {
  assert.equal(
    colorForEmail("alice@example.com"),
    colorForEmail("Alice@Example.com"),
  );
  assert.notEqual(
    colorForEmail("alice@example.com"),
    colorForEmail("bob@example.com"),
  );
});

test("initialFromName uses the first character", () => {
  assert.equal(initialFromName("alice"), "A");
  assert.equal(initialFromName("  佐藤"), "佐");
});

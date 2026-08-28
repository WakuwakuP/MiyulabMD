import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeHttpUrl } from "./http-url.ts";

test("normalizeHttpUrl accepts http(s) and adds a protocol", () => {
  assert.equal(normalizeHttpUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(normalizeHttpUrl("example.com/a"), "https://example.com/a");
  assert.equal(normalizeHttpUrl("javascript:alert(1)"), null);
  assert.equal(normalizeHttpUrl(""), null);
});

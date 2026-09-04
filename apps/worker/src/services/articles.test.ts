import assert from "node:assert/strict";
import { test } from "node:test";
import {
  escapeLikePattern,
  isAllowedWebhookUrl,
  sourceNoteFilter,
} from "./articles.ts";

test("sourceNoteFilter matches the folder and any descendant path", () => {
  const filter = sourceNoteFilter("work");
  assert.match(filter.sql, /folder = \? OR folder LIKE \? ESCAPE/);
  assert.deepEqual(filter.binds, ["work", "work/%"]);
  const escaped = sourceNoteFilter("a_b");
  assert.deepEqual(escaped.binds, ["a_b", "a\\_b/%"]);
});

test("escapeLikePattern escapes LIKE wildcards", () => {
  assert.equal(escapeLikePattern("work"), "work");
  assert.equal(escapeLikePattern("a_b%c\\d"), "a\\_b\\%c\\\\d");
});

test("isAllowedWebhookUrl allows https and local http", () => {
  assert.equal(
    isAllowedWebhookUrl("https://api.github.com/repos/org/repo/dispatches"),
    true,
  );
  assert.equal(isAllowedWebhookUrl("http://127.0.0.1:8787/hook"), true);
  assert.equal(isAllowedWebhookUrl("http://example.com/hook"), false);
  assert.equal(isAllowedWebhookUrl("not-a-url"), false);
});

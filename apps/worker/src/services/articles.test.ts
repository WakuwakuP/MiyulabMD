import assert from "node:assert/strict";
import { test } from "node:test";
import { isAllowedWebhookUrl } from "./articles.ts";

test("isAllowedWebhookUrl allows https and local http", () => {
  assert.equal(
    isAllowedWebhookUrl("https://api.github.com/repos/org/repo/dispatches"),
    true,
  );
  assert.equal(isAllowedWebhookUrl("http://127.0.0.1:8787/hook"), true);
  assert.equal(isAllowedWebhookUrl("http://example.com/hook"), false);
  assert.equal(isAllowedWebhookUrl("not-a-url"), false);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { collectStandaloneLinkUrls, standaloneLinkUrl } from "./standalone-link.ts";

test("standaloneLinkUrl accepts a lone URL or markdown link", () => {
  assert.equal(standaloneLinkUrl("https://example.com/a"), "https://example.com/a");
  assert.equal(standaloneLinkUrl("[Example](https://example.com/a)"), "https://example.com/a");
  assert.equal(standaloneLinkUrl("see https://example.com/a"), null);
  assert.equal(standaloneLinkUrl("text [Example](https://example.com/a)"), null);
});

test("collectStandaloneLinkUrls skips fenced code", () => {
  const markdown = ["https://a.example", "```", "https://b.example", "```", "hello https://c.example"].join("\n");
  assert.deepEqual(collectStandaloneLinkUrls(markdown), ["https://a.example"]);
});

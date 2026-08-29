import assert from "node:assert/strict";
import { test } from "node:test";
import { ogCacheKey, parseOgHtml } from "./og.ts";

test("parseOgHtml reads Open Graph tags from head", () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Hello &amp; Co">
    <meta name="description" content="A page">
    <meta property="og:image" content="/card.png">
    <meta property="og:site_name" content="Example">
    <title>Fallback</title>
  </head><body>${"x".repeat(200)}</body></html>`;
  const card = parseOgHtml(html, "https://example.com/post");
  assert.equal(card.title, "Hello & Co");
  assert.equal(card.description, "A page");
  assert.equal(card.image, "https://example.com/card.png");
  assert.equal(card.siteName, "Example");
});

test("ogCacheKey normalizes the target URL", () => {
  const key = ogCacheKey("https://md.example", "https://x.com/norotororo");
  assert.ok(key);
  assert.equal(
    new URL(key.url).searchParams.get("url"),
    "https://x.com/norotororo",
  );
});

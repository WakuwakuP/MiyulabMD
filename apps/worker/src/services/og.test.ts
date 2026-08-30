import assert from "node:assert/strict";
import { test } from "node:test";
import { OG_USER_AGENT } from "../og-fetch-shared.ts";
import { fetchOgPreview, ogCacheKey, parseOgHtml } from "./og.ts";

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

test("parseOgHtml decodes query entities in og:image", () => {
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Build">
    <meta property="og:image" content="https://example.com/ogp?name=a&amp;characters=1,2">
  </head></html>`;
  const card = parseOgHtml(html, "https://example.com/build");
  assert.equal(card.image, "https://example.com/ogp?name=a&characters=1,2");
});

test("fetchOgPreview sends a User-Agent", async () => {
  const original = globalThis.fetch;
  let userAgent = "";
  globalThis.fetch = async (_input, init) => {
    userAgent = new Headers(init?.headers).get("user-agent") ?? "";
    return new Response("<html><head><title>Example</title></head></html>", {
      status: 200,
    });
  };
  try {
    const result = await fetchOgPreview("https://example.com/");
    assert.ok(!("error" in result));
    assert.equal(userAgent, OG_USER_AGENT);
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchOgPreview prefers the outbound fetcher", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("should not use global fetch");
  };
  try {
    const result = await fetchOgPreview("https://example.com/", {
      fetch: async () =>
        new Response(
          `<html><head><meta property="og:title" content="Via outbound"></head></html>`,
          { status: 200 },
        ),
    });
    assert.ok(!("error" in result));
    assert.equal(result.title, "Via outbound");
  } finally {
    globalThis.fetch = original;
  }
});

test("fetchOgPreview falls back to global fetch when outbound fails", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      `<html><head><meta property="og:title" content="Direct"></head></html>`,
      { status: 200 },
    );
  try {
    const result = await fetchOgPreview("https://example.com/", {
      fetch: async () => new Response("no", { status: 530 }),
    });
    assert.ok(!("error" in result));
    assert.equal(result.title, "Direct");
  } finally {
    globalThis.fetch = original;
  }
});

test("ogCacheKey normalizes the target URL", () => {
  const key = ogCacheKey("https://md.example", "https://x.com/norotororo");
  assert.ok(key);
  assert.equal(
    new URL(key.url).searchParams.get("url"),
    "https://x.com/norotororo",
  );
});

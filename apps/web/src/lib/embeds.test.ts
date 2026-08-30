import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canonicalizeEditorMarkdown,
  collectOgUrls,
  expandEmbedsForPreview,
  renderOgCardHtml,
} from "./embeds.ts";

test("canonicalizeEditorMarkdown writes og cards as a normal URL", () => {
  assert.equal(
    canonicalizeEditorMarkdown(':::ogCard {href="https://example.com/a"} :::'),
    "https://example.com/a",
  );
  assert.equal(
    canonicalizeEditorMarkdown("[ogp](https://example.com/a)"),
    "https://example.com/a",
  );
  assert.equal(
    canonicalizeEditorMarkdown("https://example.com/a"),
    "https://example.com/a",
  );
});

test("collectOgUrls finds standalone links and leftover card syntax", () => {
  const markdown = [
    "hello https://inline.example",
    "https://alone.example",
    "[ogp](https://legacy.example)",
    ':::ogCard {href="https://block.example"} :::',
  ].join("\n");
  assert.deepEqual(collectOgUrls(markdown).sort(), [
    "https://alone.example",
    "https://block.example",
    "https://legacy.example",
  ]);
});

test("renderOgCardHtml puts text in a body that can be height-clamped", () => {
  const html = renderOgCardHtml("https://example.com/a", {
    url: "https://example.com/a",
    title: "Hello",
    description: "A long description",
    image: "https://example.com/og.png",
    siteName: "Example",
  });
  assert.match(html, /class="embed-og-body"/);
  assert.match(html, /embed-og-desc/);
  assert.match(html, /og\.png/);
});

test("expandEmbedsForPreview cards a standalone URL but not an inline one", () => {
  const cards = new Map();
  const html = expandEmbedsForPreview(
    "see https://inline.example\n\nhttps://alone.example",
    cards,
  );
  assert.match(html, /embed-og.*https:\/\/alone\.example/);
  assert.match(html, /see https:\/\/inline\.example/);
  assert.doesNotMatch(html, /see[\s\S]*embed-og[\s\S]*inline\.example/);
});

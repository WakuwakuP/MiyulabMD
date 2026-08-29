import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import {
  applyBlockType,
  BLOCK_TYPES,
  blockTypeLabel,
  currentBlockType,
  matchesSlashItem,
  SLASH_ITEMS,
} from "./slash-items.ts";

test("slash items cover turn-into block types", () => {
  for (const type of BLOCK_TYPES) {
    assert.equal(
      SLASH_ITEMS.some((item) => item.id === type.id),
      true,
      type.id,
    );
  }
});

test("matchesSlashItem matches label and aliases", () => {
  const heading = SLASH_ITEMS.find((item) => item.id === "h1");
  assert.ok(heading);
  assert.equal(matchesSlashItem(heading, ""), true);
  assert.equal(matchesSlashItem(heading, "h1"), true);
  assert.equal(matchesSlashItem(heading, "見出し"), true);
  assert.equal(matchesSlashItem(heading, "zzz"), false);
});

test("blockTypeLabel returns Japanese labels", () => {
  assert.equal(blockTypeLabel("paragraph"), "テキスト");
  assert.equal(blockTypeLabel("h2"), "見出し 2");
});

test("applyBlockType converts a paragraph into a heading", () => {
  const editor = new Editor({
    extensions: [StarterKit, Markdown],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "hello" }] },
      ],
    },
  });
  applyBlockType(editor, "h2");
  assert.equal(currentBlockType(editor), "h2");
  assert.match(editor.getMarkdown(), /^## hello/m);
  editor.destroy();
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { SafeParagraph } from "../components/editor/extensions/safe-paragraph.ts";
import { escapeMarkdownBlockPrefix } from "./rich-markdown-escape.ts";

test("escapeMarkdownBlockPrefix escapes heading and list markers", () => {
  assert.equal(escapeMarkdownBlockPrefix("## aaaaa"), "\\#\\# aaaaa");
  assert.equal(escapeMarkdownBlockPrefix("- item"), "\\- item");
  assert.equal(escapeMarkdownBlockPrefix("1. item"), "1\\. item");
  assert.equal(escapeMarkdownBlockPrefix("hello"), "hello");
});

test("paragraph markdown like ## stays a paragraph after reload", () => {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ paragraph: false, link: { openOnClick: false } }),
      SafeParagraph,
      Markdown,
    ],
    content: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "## aaaaa" }] },
      ],
    },
  });

  const markdown = editor.getMarkdown();
  assert.match(markdown, /\\#\\# aaaaa/);

  editor.commands.setContent(markdown, {
    contentType: "markdown",
    emitUpdate: false,
  });
  assert.equal(editor.state.doc.firstChild?.type.name, "paragraph");
  assert.equal(editor.state.doc.textContent, "## aaaaa");
  editor.destroy();
});

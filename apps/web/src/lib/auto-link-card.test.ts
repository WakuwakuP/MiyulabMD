import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { paragraphStandaloneHref } from "../components/editor/extensions/auto-link-card.ts";

function editorFor(markdown: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Markdown,
    ],
    content: markdown,
    contentType: "markdown",
  });
}

test("paragraphStandaloneHref cards a lone URL or link paragraph", () => {
  const url = editorFor("https://example.com/a");
  assert.equal(
    paragraphStandaloneHref(url.state.doc.child(0)),
    "https://example.com/a",
  );

  const titled = editorFor("[Example](https://example.com/a)");
  assert.equal(
    paragraphStandaloneHref(titled.state.doc.child(0)),
    "https://example.com/a",
  );

  const inline = editorFor("see https://example.com/a");
  assert.equal(paragraphStandaloneHref(inline.state.doc.child(0)), null);
  url.destroy();
  titled.destroy();
  inline.destroy();
});

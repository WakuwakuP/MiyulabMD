import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { HighlightedCodeBlock } from "./extensions/code-block.ts";

function editorFor(markdown: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      HighlightedCodeBlock,
      Markdown,
    ],
    content: markdown,
    contentType: "markdown",
  });
}

function codeAttrs(editor: Editor) {
  let attrs: Record<string, unknown> | null = null;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "codeBlock")
      attrs = node.attrs as Record<string, unknown>;
  });
  assert.ok(attrs, "missing code block");
  return attrs;
}

test("rich code block parses language:filename fences", () => {
  const editor = editorFor("```typescript:hoge.ts\nconst x = 1\n```\n");
  const attrs = codeAttrs(editor);
  assert.equal(attrs.language, "typescript");
  assert.equal(attrs.filename, "hoge.ts");
  assert.match(editor.getMarkdown(), /```typescript:hoge\.ts/);
  editor.destroy();
});

test("rich code block parses filename-only fences", () => {
  const editor = editorFor("```hoge.ts\nconst x = 1\n```\n");
  const attrs = codeAttrs(editor);
  assert.equal(attrs.language, "typescript");
  assert.equal(attrs.filename, "hoge.ts");
  assert.match(editor.getMarkdown(), /```typescript:hoge\.ts/);
  editor.destroy();
});

test("rich code block writes language:filename when both are set", () => {
  const editor = editorFor("```typescript\nconst x = 1\n```\n");
  editor.commands.updateAttributes("codeBlock", { filename: "app.ts" });
  assert.match(editor.getMarkdown(), /```typescript:app\.ts/);
  editor.destroy();
});

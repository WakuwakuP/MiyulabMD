import assert from "node:assert/strict";
import { test } from "node:test";
import { Editor, Node } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import {
  autoLinkCardTransaction,
  expandOgCard,
  paragraphStandaloneHref,
} from "../components/editor/extensions/auto-link-card.ts";

const TestOgCard = Node.create({
  name: "ogCard",
  group: "block",
  atom: true,
  addAttributes() {
    return { href: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-og-card]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", HTMLAttributes];
  },
});

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

function cardEditor(markdown: string): Editor {
  return new Editor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Markdown,
      TestOgCard,
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

test("paragraphStandaloneHref ignores Firefox trailing hardBreaks", () => {
  const editor = editorFor("hello");
  editor.commands.setContent({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "https://example.com/a" },
          { type: "hardBreak" },
        ],
      },
    ],
  });
  assert.equal(
    paragraphStandaloneHref(editor.state.doc.child(0)),
    "https://example.com/a",
  );

  editor.commands.setContent({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            marks: [{ type: "link", attrs: { href: "https://example.com/a" } }],
            text: "Example\u200B",
          },
          { type: "hardBreak" },
        ],
      },
    ],
  });
  assert.equal(
    paragraphStandaloneHref(editor.state.doc.child(0)),
    "https://example.com/a",
  );
  editor.destroy();
});

test("autoLinkCardTransaction cards a standalone URL once the caret leaves", () => {
  const editor = cardEditor("https://example.com/a\n\nnext");
  assert.equal(autoLinkCardTransaction(editor.state), null);

  const nextPos = editor.state.doc.child(0).nodeSize + 1;
  editor.commands.setTextSelection(nextPos);
  const tr = autoLinkCardTransaction(editor.state);
  assert.ok(tr);
  editor.view.dispatch(tr);

  assert.equal(editor.state.doc.child(0).type.name, "ogCard");
  assert.equal(editor.state.doc.child(0).attrs.href, "https://example.com/a");
  editor.destroy();
});

test("autoLinkCardTransaction cards a pasted standalone URL in place", () => {
  const editor = cardEditor("https://example.com/a");
  const tr = autoLinkCardTransaction(editor.state, true);
  assert.ok(tr);
  editor.view.dispatch(tr);
  assert.equal(editor.state.doc.child(0).type.name, "ogCard");
  assert.equal(editor.state.doc.child(0).attrs.href, "https://example.com/a");
  editor.destroy();
});

test("expandOgCard turns a card into selected link text", () => {
  const editor = cardEditor("next");
  const href = "https://example.com/a";
  editor.commands.insertContentAt(0, { type: "ogCard", attrs: { href } });

  let cardPos = -1;
  editor.state.doc.forEach((node, pos) => {
    if (node.type.name === "ogCard") cardPos = pos;
  });
  assert.notEqual(cardPos, -1);

  const tr = expandOgCard(editor.state, cardPos);
  assert.ok(tr);
  editor.view.dispatch(tr);

  const paragraph = editor.state.doc.child(0);
  assert.equal(paragraph.type.name, "paragraph");
  assert.equal(paragraph.textContent, href);
  assert.ok(
    paragraph.firstChild?.marks.some((mark) => mark.type.name === "link"),
  );
  assert.equal(editor.state.selection.from, 1);
  assert.equal(editor.state.selection.to, 1 + href.length);
  assert.equal(autoLinkCardTransaction(editor.state), null);
  editor.destroy();
});

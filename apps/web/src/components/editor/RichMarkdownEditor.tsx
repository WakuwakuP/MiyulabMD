import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Youtube from "@tiptap/extension-youtube";
import { Markdown } from "@tiptap/markdown";
import type { Editor } from "@tiptap/react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import type * as Y from "yjs";
import { fetchOgPreview, uploadImage } from "../../lib/api.ts";
import type { CollabAwareness } from "../../lib/collaboration.ts";
import { canonicalizeEditorMarkdown, normalizeEmbedMarkdown } from "../../lib/embeds.ts";
import {
  buildOffsetMap,
  clampPos,
  markdownEquivalent,
  mdToPm,
  pmToMd,
  type OffsetMap,
} from "../../lib/markdown-pm-map.ts";
import { readRemoteMarkdownCursors, writeMarkdownCursor } from "../../lib/rich-awareness.ts";
import { applyTextDiff, inspectPlainTextDelta, type YTextDeltaItem } from "../../lib/y-text-diff.ts";
import { CollabCarets, collabCaretsKey } from "./extensions/collab-carets.ts";
import { OgCard } from "./extensions/og-card.ts";

type Props = {
  noteId: string;
  yText: Y.Text;
  awareness: CollabAwareness;
  readOnly?: boolean;
};

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function firstImageFile(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const file of data.files) {
    if (IMAGE_TYPES.has(file.type)) return file;
  }
  return null;
}

function editorMarkdown(editor: Editor): string {
  return canonicalizeEditorMarkdown(editor.getMarkdown());
}

function trySurgicalApply(
  editor: Editor,
  map: OffsetMap,
  delta: YTextDeltaItem[],
): boolean {
  const plain = inspectPlainTextDelta(delta);
  if (!plain) return false;

  if (plain.kind === "insert") {
    const pos = clampPos(editor.state.doc, mdToPm(map, plain.index));
    const $pos = editor.state.doc.resolve(pos);
    if (!$pos.parent.isTextblock) return false;
    editor.view.dispatch(editor.state.tr.insertText(plain.text, pos).setMeta("addToHistory", false));
    return true;
  }

  const from = clampPos(editor.state.doc, mdToPm(map, plain.index));
  const to = clampPos(editor.state.doc, mdToPm(map, plain.index + plain.length));
  if (from === to) return false;
  const $from = editor.state.doc.resolve(from);
  const $to = editor.state.doc.resolve(to);
  if ($from.parent !== $to.parent || !$from.parent.isTextblock) return false;
  editor.view.dispatch(editor.state.tr.delete(from, to).setMeta("addToHistory", false));
  return true;
}

export function RichMarkdownEditor({ noteId, yText, awareness, readOnly = false }: Props) {
  const applyingRemote = useRef(false);
  const composing = useRef(false);
  const pendingRemote = useRef(false);
  const lastYMarkdown = useRef(yText.toString());
  const mapRef = useRef<OffsetMap | null>(null);
  const editorRef = useRef<Editor | null>(null);

  const refreshMap = (editor: Editor, markdown = yText.toString()) => {
    mapRef.current = buildOffsetMap(editor.state.doc, markdown);
    return mapRef.current;
  };

  const publishCursor = (editor: Editor) => {
    const map = refreshMap(editor);
    writeMarkdownCursor(
      awareness,
      yText,
      pmToMd(map, editor.state.selection.anchor),
      pmToMd(map, editor.state.selection.head),
    );
  };

  const refreshCarets = (editor: Editor) => {
    refreshMap(editor);
    editor.view.dispatch(editor.state.tr.setMeta(collabCaretsKey, true));
  };

  const applyRemote = (editor: Editor, delta: YTextDeltaItem[]) => {
    const next = yText.toString();
    if (markdownEquivalent(editorMarkdown(editor), next)) {
      lastYMarkdown.current = next;
      refreshMap(editor, next);
      return;
    }

    const map = buildOffsetMap(editor.state.doc, lastYMarkdown.current);
    const mdFrom = pmToMd(map, editor.state.selection.from);
    const mdTo = pmToMd(map, editor.state.selection.to);

    applyingRemote.current = true;
    const surgical = trySurgicalApply(editor, map, delta);
    if (!surgical) {
      editor.commands.setContent(normalizeEmbedMarkdown(next), {
        contentType: "markdown",
        emitUpdate: false,
      });
      const restored = buildOffsetMap(editor.state.doc, next);
      editor.commands.setTextSelection({
        from: clampPos(editor.state.doc, mdToPm(restored, mdFrom)),
        to: clampPos(editor.state.doc, mdToPm(restored, mdTo)),
      });
    }
    applyingRemote.current = false;
    lastYMarkdown.current = next;
    refreshCarets(editor);
    publishCursor(editor);
  };

  const flushLocal = (editor: Editor) => {
    if (applyingRemote.current || composing.current || readOnly) return;
    const next = editorMarkdown(editor);
    if (markdownEquivalent(lastYMarkdown.current, next) || markdownEquivalent(yText.toString(), next)) {
      lastYMarkdown.current = yText.toString();
      refreshMap(editor);
      return;
    }
    applyTextDiff(yText, next, "rich");
    lastYMarkdown.current = yText.toString();
    refreshMap(editor);
    publishCursor(editor);
  };

  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
      Markdown,
      Image,
      Youtube.configure({ controls: true, nocookie: true, width: 640, height: 360 }),
      OgCard,
      Placeholder.configure({ placeholder: "本文を入力" }),
      CollabCarets.configure({
        getMap: () => mapRef.current,
        getPeers: () => readRemoteMarkdownCursors(awareness, yText),
      }),
    ],
    content: normalizeEmbedMarkdown(yText.toString()),
    contentType: "markdown",
    editorProps: {
      handleDOMEvents: {
        compositionstart: () => {
          composing.current = true;
          return false;
        },
        compositionend: () => {
          composing.current = false;
          const current = editorRef.current;
          if (current) {
            flushLocal(current);
            if (pendingRemote.current) {
              pendingRemote.current = false;
              applyRemote(current, []);
            }
          }
          return false;
        },
      },
      handlePaste(_view, event) {
        if (readOnly) return false;
        const file = firstImageFile(event.clipboardData);
        if (!file) return false;
        event.preventDefault();
        void uploadImage(noteId, file).then((result) => {
          if (result.ok) editor?.chain().focus().setImage({ src: result.data.url }).run();
        });
        return true;
      },
      handleDrop(_view, event) {
        if (readOnly) return false;
        const file = firstImageFile(event.dataTransfer);
        if (!file) return false;
        event.preventDefault();
        void uploadImage(noteId, file).then((result) => {
          if (result.ok) editor?.chain().focus().setImage({ src: result.data.url }).run();
        });
        return true;
      },
    },
    onCreate: ({ editor: next }) => {
      editorRef.current = next;
      lastYMarkdown.current = yText.toString();
      refreshMap(next);
    },
    onUpdate: ({ editor: next }) => {
      flushLocal(next);
    },
    onSelectionUpdate: ({ editor: next }) => {
      if (!applyingRemote.current) publishCursor(next);
    },
  });

  useEffect(() => {
    editorRef.current = editor;
    if (editor) refreshMap(editor);
  }, [editor]);

  useEffect(() => {
    if (!editor) return;

    const sync = (event: Y.YTextEvent, transaction: Y.Transaction) => {
      if (transaction.local) {
        lastYMarkdown.current = yText.toString();
        return;
      }
      if (composing.current) {
        pendingRemote.current = true;
        return;
      }
      applyRemote(editor, event.delta as YTextDeltaItem[]);
    };

    yText.observe(sync);
    return () => yText.unobserve(sync);
  }, [editor, yText]);

  useEffect(() => {
    if (!editor) return;
    const onAwareness = () => refreshCarets(editor);
    awareness.on("change", onAwareness);
    refreshCarets(editor);
    return () => {
      awareness.off("change", onAwareness);
    };
  }, [editor, awareness]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  const imageInputRef = useRef<HTMLInputElement>(null);

  async function insertImageFile(file: File) {
    const result = await uploadImage(noteId, file);
    if (result.ok) editor?.chain().focus().setImage({ src: result.data.url }).run();
  }

  function insertYoutube() {
    const url = window.prompt("YouTube の URL");
    if (!url || !editor) return;
    editor.chain().focus().setYoutubeVideo({ src: url }).run();
  }

  async function insertOg() {
    const url = window.prompt("リンクの URL（OGP カード）");
    if (!url || !editor) return;
    await fetchOgPreview(url);
    editor.chain().focus().insertContent({ type: "ogCard", attrs: { href: url } }).run();
  }

  if (!editor) {
    return <div className="rich-editor rich-editor--loading">読み込み中…</div>;
  }

  return (
    <div className="rich-editor">
      {!readOnly && (
        <div className="rich-toolbar" role="toolbar" aria-label="書式">
          <button type="button" onClick={() => editor.chain().focus().toggleBold().run()}>
            太字
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()}>
            斜体
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            見出し
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()}>
            リスト
          </button>
          <button type="button" onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
            コード
          </button>
          <button type="button" onClick={() => imageInputRef.current?.click()}>
            画像
          </button>
          <input
            ref={imageInputRef}
            type="file"
            accept={[...IMAGE_TYPES].join(",")}
            aria-label="画像をアップロード"
            className="rich-file-input"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void insertImageFile(file);
            }}
          />
          <button type="button" onClick={insertYoutube}>
            YouTube
          </button>
          <button type="button" onClick={() => void insertOg()}>
            リンクカード
          </button>
        </div>
      )}
      <EditorContent editor={editor} className="rich-editor-content" />
    </div>
  );
}

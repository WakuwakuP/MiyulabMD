import Image from "@tiptap/extension-image";
import { NodeRange } from "@tiptap/extension-node-range";
import Placeholder from "@tiptap/extension-placeholder";
import { TableKit } from "@tiptap/extension-table";
import Youtube from "@tiptap/extension-youtube";
import { Markdown } from "@tiptap/markdown";
import type { Editor } from "@tiptap/react";
import { EditorContent, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { fetchOgPreview, uploadImage } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import type { CollabAwareness } from "../../lib/collaboration.ts";
import {
  canonicalizeEditorMarkdown,
  normalizeEmbedMarkdown,
} from "../../lib/embeds.ts";
import {
  buildOffsetMap,
  clampPos,
  markdownEquivalent,
  mdToPm,
  type OffsetMap,
  pmToMd,
} from "../../lib/markdown-pm-map.ts";
import {
  readRemoteMarkdownCursors,
  writeMarkdownCursor,
} from "../../lib/rich-awareness.ts";
import {
  applyTextDiff,
  inspectPlainTextDelta,
  type YTextDeltaItem,
} from "../../lib/y-text-diff.ts";
import { FileInput } from "../ui/FileInput.tsx";
import {
  documentScrollPadClass,
  editorLoadingClass,
  richEditorPlaceholderClass,
  richEditorProseClass,
  richEditorTiptapClass,
} from "../ui/prose.ts";
import { BlockHandle } from "./BlockHandle.tsx";
import { CodeBlockView } from "./CodeBlockView.tsx";
import { AutoLinkCard } from "./extensions/auto-link-card.ts";
import { HighlightedCodeBlock } from "./extensions/code-block.ts";
import { CollabCarets, collabCaretsKey } from "./extensions/collab-carets.ts";
import { OgCard } from "./extensions/og-card.ts";
import { SafeParagraph } from "./extensions/safe-paragraph.ts";
import { LinkModal } from "./LinkModal.tsx";
import { SelectionToolbar } from "./SelectionToolbar.tsx";
import { SlashCommandMenu } from "./SlashCommandMenu.tsx";

type Props = {
  noteId: string;
  yText: Y.Text;
  awareness: CollabAwareness;
  readOnly?: boolean;
};

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

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
    editor.view.dispatch(
      editor.state.tr
        .insertText(plain.text, pos)
        .setMeta("addToHistory", false),
    );
    return true;
  }

  const from = clampPos(editor.state.doc, mdToPm(map, plain.index));
  const to = clampPos(
    editor.state.doc,
    mdToPm(map, plain.index + plain.length),
  );
  if (from === to) return false;
  const $from = editor.state.doc.resolve(from);
  const $to = editor.state.doc.resolve(to);
  if ($from.parent !== $to.parent || !$from.parent.isTextblock) return false;
  editor.view.dispatch(
    editor.state.tr.delete(from, to).setMeta("addToHistory", false),
  );
  return true;
}

export function RichMarkdownEditor({
  noteId,
  yText,
  awareness,
  readOnly = false,
}: Props) {
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
    if (
      markdownEquivalent(lastYMarkdown.current, next) ||
      markdownEquivalent(yText.toString(), next)
    ) {
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
      StarterKit.configure({
        paragraph: false,
        codeBlock: false,
        link: { openOnClick: false, autolink: true },
        dropcursor: {
          color: "color-mix(in srgb, CanvasText 35%, transparent)",
          width: 2,
        },
      }),
      HighlightedCodeBlock.extend({
        addNodeView() {
          return ReactNodeViewRenderer(CodeBlockView);
        },
      }),
      NodeRange,
      SafeParagraph,
      TableKit.configure({
        table: { resizable: false },
      }),
      Markdown,
      Image,
      Youtube.configure({
        controls: true,
        nocookie: true,
        width: 640,
        height: 360,
      }),
      OgCard,
      AutoLinkCard,
      Placeholder.configure({
        includeChildren: true,
        placeholder: ({ node }) => {
          if (node.type.name === "heading") {
            return `見出し ${node.attrs.level}`;
          }
          return "「/」でブロックを挿入";
        },
      }),
      CollabCarets.configure({
        getMap: () => mapRef.current,
        getPeers: () => readRemoteMarkdownCursors(awareness, yText),
      }),
    ],
    content: normalizeEmbedMarkdown(yText.toString()),
    contentType: "markdown",
    editorProps: {
      attributes: {
        class: richEditorTiptapClass,
      },
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
          if (result.ok)
            editor?.chain().focus().setImage({ src: result.data.url }).run();
        });
        return true;
      },
      handleDrop(_view, event) {
        if (readOnly) return false;
        const file = firstImageFile(event.dataTransfer);
        if (!file) return false;
        event.preventDefault();
        void uploadImage(noteId, file).then((result) => {
          if (result.ok)
            editor?.chain().focus().setImage({ src: result.data.url }).run();
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
  const [linkModal, setLinkModal] = useState<"card" | "inline" | null>(null);

  async function insertImageFile(file: File) {
    const result = await uploadImage(noteId, file);
    if (result.ok)
      editor?.chain().focus().setImage({ src: result.data.url }).run();
  }

  function insertYoutube() {
    const url = window.prompt("YouTube の URL");
    if (!url || !editor) return;
    editor.chain().focus().setYoutubeVideo({ src: url }).run();
  }

  async function insertStandaloneLink(url: string) {
    if (!editor) return;
    await fetchOgPreview(url);
    editor
      .chain()
      .focus()
      .insertContent({ type: "ogCard", attrs: { href: url } })
      .run();
  }

  function applyInlineLink(url: string) {
    editor?.chain().focus().setLink({ href: url }).run();
  }

  if (!editor) {
    return <div className={editorLoadingClass}>読み込み中…</div>;
  }

  const commandHandlers = {
    onImage: () => imageInputRef.current?.click(),
    onYoutube: insertYoutube,
    onOgCard: () => setLinkModal("card"),
  };

  return (
    <div className="flex min-h-96 flex-col overflow-hidden [[data-layout=editor]_&]:h-full [[data-layout=editor]_&]:min-h-0">
      <FileInput
        ref={imageInputRef}
        accept={[...IMAGE_TYPES].join(",")}
        aria-label="画像をアップロード"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void insertImageFile(file);
        }}
      />
      <EditorContent
        editor={editor}
        className={cn(
          "rich-editor-content flex flex-1 justify-center overflow-auto",
          documentScrollPadClass,
          richEditorProseClass,
          richEditorPlaceholderClass,
        )}
      />
      {!readOnly && (
        <>
          <SlashCommandMenu editor={editor} handlers={commandHandlers} />
          <BlockHandle editor={editor} handlers={commandHandlers} />
          <SelectionToolbar
            editor={editor}
            onLink={() => setLinkModal("inline")}
          />
        </>
      )}
      {linkModal && (
        <LinkModal
          title={linkModal === "card" ? "リンクカード" : "リンク"}
          initial={
            linkModal === "inline"
              ? String(editor.getAttributes("link").href ?? "")
              : ""
          }
          submitLabel="挿入"
          onSubmit={(url) => {
            if (linkModal === "card") void insertStandaloneLink(url);
            else applyInlineLink(url);
            setLinkModal(null);
          }}
          onClose={() => setLinkModal(null)}
        />
      )}
    </div>
  );
}

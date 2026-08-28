import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView, highlightActiveLine } from "@codemirror/view";
import { useEffect, useRef } from "react";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import type { CollabAwareness } from "../../lib/collaboration.ts";
import { uploadImage } from "../../lib/api.ts";

type Props = {
  noteId: string;
  yText: Y.Text;
  awareness: CollabAwareness;
  readOnly?: boolean;
};

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function imageFileFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;

  for (const item of data.items) {
    if (item.kind === "file" && IMAGE_TYPES.has(item.type)) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }

  return null;
}

function imageFileFromDataTransfer(data: DataTransfer | null): File | null {
  if (!data) return null;

  for (const file of data.files) {
    if (IMAGE_TYPES.has(file.type)) {
      return file;
    }
  }

  return null;
}

function dataTransferHasImage(data: DataTransfer | null): boolean {
  return imageFileFromDataTransfer(data) !== null;
}

function insertMarkdownImage(view: EditorView, yText: Y.Text, url: string) {
  const markdown = `![](${url})`;
  const pos = view.state.selection.main.head;
  yText.insert(pos, markdown);
  const nextPos = pos + markdown.length;
  view.dispatch({
    selection: { anchor: nextPos, head: nextPos },
  });
}

function imageUploadHandlers(noteId: string, yText: Y.Text, readOnly: boolean) {
  async function handleImageFile(view: EditorView, file: File) {
    const result = await uploadImage(noteId, file);
    if (!result.ok) {
      console.error("image upload failed:", result.error);
      return;
    }
    insertMarkdownImage(view, yText, result.data.url);
  }

  return EditorView.domEventHandlers({
    paste(event, view) {
      if (readOnly) return false;
      const file = imageFileFromClipboard(event.clipboardData);
      if (!file) return false;

      event.preventDefault();
      void handleImageFile(view, file);
      return true;
    },
    dragover(event) {
      if (readOnly) return false;
      if (!dataTransferHasImage(event.dataTransfer)) return false;
      event.preventDefault();
      return true;
    },
    drop(event, view) {
      if (readOnly) return false;
      const file = imageFileFromDataTransfer(event.dataTransfer);
      if (!file) return false;

      event.preventDefault();
      void handleImageFile(view, file);
      return true;
    },
  });
}

export function MarkdownEditor({ noteId, yText, awareness, readOnly = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const undoManager = readOnly ? false : new Y.UndoManager(yText);

    const state = EditorState.create({
      doc: yText.toString(),
      extensions: [
        markdown(),
        highlightActiveLine(),
        EditorView.lineWrapping,
        EditorView.theme({
          ".cm-content": { caretColor: "CanvasText" },
          ".cm-line": { caretColor: "CanvasText" },
        }),
        yCollab(yText, awareness, { undoManager }),
        EditorView.editable.of(!readOnly),
        imageUploadHandlers(noteId, yText, readOnly),
      ],
    });

    const view = new EditorView({ state, parent: container });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [noteId, yText, awareness, readOnly]);

  return <div ref={containerRef} className="markdown-editor" />;
}

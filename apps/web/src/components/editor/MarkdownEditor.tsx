import { EditorState } from "@codemirror/state";
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
  scrollPastEnd,
} from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { uploadImage } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import type { CollabAwareness } from "../../lib/collaboration.ts";
import { readEditorScrollPadPx } from "../../lib/visual-viewport.ts";
import "../../styles/cm-highlight.css";
import { ContextMenu } from "../notes/ContextMenu.tsx";
import { FileInput } from "../ui/FileInput.tsx";
import {
  markdownEditorHighlight,
  markdownEditorLanguage,
} from "./cmMarkdownExtensions.ts";

type Props = {
  noteId: string;
  yText: Y.Text;
  awareness: CollabAwareness;
  readOnly?: boolean;
  lineNumbers?: boolean;
  scrollRatio?: number;
  onScrollRatio?: (ratio: number) => void;
};

const IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

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

function imageUploadHandlers(
  noteId: string,
  yText: Y.Text,
  readOnly: boolean,
  onContextMenu: (event: MouseEvent, view: EditorView) => void,
) {
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
    contextmenu(event, view) {
      if (readOnly) return false;
      event.preventDefault();
      const coords = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (coords != null) {
        view.dispatch({ selection: { anchor: coords, head: coords } });
      }
      onContextMenu(event, view);
      return true;
    },
  });
}

function scrollRatioFrom(el: HTMLElement): number {
  const max = el.scrollHeight - el.clientHeight;
  return max <= 0 ? 0 : el.scrollTop / max;
}

function applyScrollRatio(el: HTMLElement, ratio: number) {
  const max = el.scrollHeight - el.clientHeight;
  if (max <= 0) return;
  el.scrollTop = max * ratio;
}

export function MarkdownEditor({
  noteId,
  yText,
  awareness,
  readOnly = false,
  lineNumbers: showLineNumbers = false,
  scrollRatio,
  onScrollRatio,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onContextMenuRef = useRef<
    (event: MouseEvent, view: EditorView) => void
  >(() => undefined);
  const onScrollRatioRef = useRef(onScrollRatio);
  const applyingScroll = useRef(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  onContextMenuRef.current = (event) => {
    setMenu({ x: event.clientX, y: event.clientY });
  };
  onScrollRatioRef.current = onScrollRatio;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const undoManager = readOnly ? false : new Y.UndoManager(yText);

    const state = EditorState.create({
      doc: yText.toString(),
      extensions: [
        markdownEditorLanguage,
        ...markdownEditorHighlight,
        ...(showLineNumbers
          ? [lineNumbers(), highlightActiveLineGutter()]
          : []),
        highlightActiveLine(),
        scrollPastEnd(),
        EditorView.scrollMargins.of((view) => {
          const pad = readEditorScrollPadPx(view.dom);
          return { top: pad, bottom: pad };
        }),
        EditorView.lineWrapping,
        EditorView.theme({
          "&": {
            backgroundColor: "var(--color-canvas)",
            color: "var(--color-ink)",
          },
          ".cm-content": { caretColor: "var(--color-ink)" },
          ".cm-line": { caretColor: "var(--color-ink)" },
          ".cm-gutters": {
            backgroundColor: "var(--cm-gutter-bg)",
            color: "var(--color-muted)",
            borderRight: "1px solid var(--color-border)",
          },
          ".cm-activeLineGutter": {
            backgroundColor: "var(--cm-gutter-active-bg)",
          },
          ".cm-activeLine": {
            backgroundColor: "var(--color-preview)",
          },
        }),
        yCollab(yText, awareness, { undoManager }),
        EditorView.editable.of(!readOnly),
        imageUploadHandlers(noteId, yText, readOnly, (event, view) => {
          onContextMenuRef.current(event, view);
        }),
        EditorView.domEventHandlers({
          scroll(_event, view) {
            if (applyingScroll.current) return false;
            onScrollRatioRef.current?.(scrollRatioFrom(view.scrollDOM));
            return false;
          },
        }),
      ],
    });

    const view = new EditorView({ state, parent: container });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [noteId, yText, awareness, readOnly, showLineNumbers]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || scrollRatio == null) return;
    if (Math.abs(scrollRatioFrom(view.scrollDOM) - scrollRatio) < 0.004) return;
    applyingScroll.current = true;
    applyScrollRatio(view.scrollDOM, scrollRatio);
    const timer = window.requestAnimationFrame(() => {
      applyingScroll.current = false;
    });
    return () => window.cancelAnimationFrame(timer);
  }, [scrollRatio]);

  async function uploadAtCursor(file: File) {
    const view = viewRef.current;
    if (!view) return;
    const result = await uploadImage(noteId, file);
    if (!result.ok) {
      console.error("image upload failed:", result.error);
      return;
    }
    insertMarkdownImage(view, yText, result.data.url);
  }

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          "min-h-96 overflow-hidden rounded-md border border-border",
          "[[data-layout=editor]_&]:h-full [[data-layout=editor]_&]:min-h-0 [[data-layout=editor]_&]:rounded-none [[data-layout=editor]_&]:border-0",
          "[&_.cm-editor]:h-full [&_.cm-editor]:min-h-96 [[data-layout=editor]_&_.cm-editor]:min-h-0",
          "[&_.cm-scroller]:font-mono [&_.cm-scroller]:text-[0.95rem]",
          "[&_.cm-editor]:caret-ink [&_.cm-content]:caret-ink [&_.cm-line]:caret-ink",
          "[&_.cm-cursor]:!border-l-ink [&_.cm-cursor-primary]:!border-l-ink",
          "[&_.cm-ySelectionInfo]:!opacity-100 [&_.cm-ySelectionInfo]:![transition-delay:0s]",
          "[&_.cm-ySelectionCaret]:border-x-2",
        )}
      />
      <FileInput
        ref={fileInputRef}
        accept={[...IMAGE_TYPES].join(",")}
        aria-label="画像をアップロード"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void uploadAtCursor(file);
        }}
      />
      {menu && !readOnly && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: "画像をアップロード",
              onSelect: () => fileInputRef.current?.click(),
            },
          ]}
        />
      )}
    </>
  );
}

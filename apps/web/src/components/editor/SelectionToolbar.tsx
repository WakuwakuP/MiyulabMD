import type { Editor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn.ts";

type Pos = { top: number; left: number };

function readToolbarPos(editor: Editor): Pos | null {
  const { empty, from, to } = editor.state.selection;
  if (empty || from === to) return null;
  const start = editor.view.coordsAtPos(from);
  const end = editor.view.coordsAtPos(to);
  const left = (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2;
  const top = Math.min(start.top, end.top) - 8;
  return { top, left };
}

type Props = {
  editor: Editor;
  onLink: () => void;
};

export function SelectionToolbar({ editor, onLink }: Props) {
  const [pos, setPos] = useState<Pos | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    const sync = () => {
      setPos(readToolbarPos(editor));
      setTick((value) => value + 1);
    };
    editor.on("selectionUpdate", sync);
    editor.on("transaction", sync);
    const scroller = editor.view.dom.closest(".rich-editor-content");
    scroller?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    sync();
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("transaction", sync);
      scroller?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [editor]);

  if (!pos) return null;

  const itemClass = (active: boolean) =>
    cn(
      "min-w-7 cursor-pointer rounded-[7px] border-0 bg-transparent px-[0.45rem] py-[0.3rem] hover:bg-surface",
      active && "bg-surface",
    );

  return (
    <div
      className="fixed z-30 flex -translate-x-1/2 -translate-y-full gap-[0.15rem] rounded-[10px] border border-border bg-canvas p-1 shadow-menu"
      style={{ top: pos.top, left: pos.left }}
    >
      <button
        type="button"
        className={cn(itemClass(editor.isActive("bold")), "font-bold")}
        aria-label="太字"
        onMouseDown={(event) => {
          event.preventDefault();
          editor.chain().focus().toggleBold().run();
        }}
      >
        B
      </button>
      <button
        type="button"
        className={cn(itemClass(editor.isActive("italic")), "italic")}
        aria-label="斜体"
        onMouseDown={(event) => {
          event.preventDefault();
          editor.chain().focus().toggleItalic().run();
        }}
      >
        I
      </button>
      <button
        type="button"
        className={cn(itemClass(editor.isActive("strike")), "line-through")}
        aria-label="打ち消し"
        onMouseDown={(event) => {
          event.preventDefault();
          editor.chain().focus().toggleStrike().run();
        }}
      >
        S
      </button>
      <button
        type="button"
        className={itemClass(editor.isActive("code"))}
        aria-label="コード"
        onMouseDown={(event) => {
          event.preventDefault();
          editor.chain().focus().toggleCode().run();
        }}
      >
        {"</>"}
      </button>
      <button
        type="button"
        className={itemClass(editor.isActive("link"))}
        aria-label="リンク"
        onMouseDown={(event) => {
          event.preventDefault();
          onLink();
        }}
      >
        リンク
      </button>
    </div>
  );
}

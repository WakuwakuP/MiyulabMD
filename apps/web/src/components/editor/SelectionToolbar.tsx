import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { useDismiss } from "../../hooks/use-dismiss.ts";
import { cn } from "../../lib/cn.ts";
import { ChevronDownIcon } from "../ui/icons.tsx";
import { MenuItem, MenuPanel } from "../ui/Menu.tsx";
import {
  applyBlockType,
  BLOCK_TYPES,
  type BlockType,
  blockTypeLabel,
  currentBlockType,
} from "./slash-items.ts";

type Pos = { top: number; left: number };

function readToolbarPos(editor: Editor): Pos | null {
  const { empty, from, to } = editor.state.selection;
  if (empty || from === to) return null;
  const start = editor.view.coordsAtPos(from);
  const end = editor.view.coordsAtPos(to);
  const left =
    (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2;
  const top = Math.min(start.top, end.top) - 8;
  return { top, left };
}

type Props = {
  editor: Editor;
  onLink: () => void;
};

export function SelectionToolbar({ editor, onLink }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [turnOpen, setTurnOpen] = useState(false);
  const [, setTick] = useState(0);

  useDismiss(turnOpen, () => setTurnOpen(false), rootRef);

  useEffect(() => {
    const sync = () => {
      const next = readToolbarPos(editor);
      setPos(next);
      if (!next) setTurnOpen(false);
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

  const activeType = currentBlockType(editor);

  const itemClass = (active: boolean) =>
    cn(
      "min-w-7 cursor-pointer rounded-[7px] border-0 bg-transparent px-[0.45rem] py-[0.3rem] hover:bg-surface",
      active && "bg-surface",
    );

  function turnInto(type: BlockType) {
    applyBlockType(editor, type);
    setTurnOpen(false);
  }

  return (
    <div
      ref={rootRef}
      className="fixed z-30 flex -translate-x-1/2 -translate-y-full items-center gap-[0.15rem] rounded-[10px] border border-border bg-canvas p-1 shadow-menu"
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="relative">
        <button
          type="button"
          className={cn(
            itemClass(turnOpen),
            "inline-flex items-center gap-1 px-[0.55rem]",
          )}
          aria-haspopup="menu"
          aria-expanded={turnOpen}
          onMouseDown={(event) => {
            event.preventDefault();
            setTurnOpen((value) => !value);
          }}
        >
          {blockTypeLabel(activeType)}
          <ChevronDownIcon className="opacity-70" />
        </button>
        {turnOpen && (
          <MenuPanel align="start" width="11rem" style={{ zIndex: 40 }}>
            {BLOCK_TYPES.map((item) => (
              <MenuItem
                key={item.id}
                active={item.id === activeType}
                onClick={() => turnInto(item.id)}
              >
                {item.label}
              </MenuItem>
            ))}
          </MenuPanel>
        )}
      </div>
      <span className="mx-[0.1rem] h-5 w-px bg-border" />
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

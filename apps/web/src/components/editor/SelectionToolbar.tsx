import type { Editor } from "@tiptap/react";
import { Bold, Code, Italic, Link, Strikethrough } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useDismiss } from "../../hooks/use-dismiss.ts";
import { cn } from "../../lib/cn.ts";
import { ChevronDownIcon } from "../ui/icons.tsx";
import { MenuItem, MenuPanel } from "../ui/Menu.tsx";
import { SlashItemIcon } from "./slash-icons.tsx";
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
  if (empty || from === to) {
    return null;
  }
  const start = editor.view.coordsAtPos(from);
  const end = editor.view.coordsAtPos(to);
  const left =
    (Math.min(start.left, end.left) + Math.max(start.right, end.right)) / 2;
  const top = Math.min(start.top, end.top) - 8;
  return { left, top };
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
      if (!next) {
        setTurnOpen(false);
      }
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

  if (!pos) {
    return null;
  }

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
      className="fixed z-30 flex -translate-x-1/2 -translate-y-full items-center gap-[0.15rem] rounded-[10px] border border-border bg-canvas p-1 shadow-menu"
      ref={rootRef}
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="relative">
        <button
          aria-expanded={turnOpen}
          aria-haspopup="menu"
          className={cn(
            itemClass(turnOpen),
            "inline-flex items-center gap-1 px-[0.55rem]",
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            setTurnOpen((value) => !value);
          }}
          type="button"
        >
          {blockTypeLabel(activeType)}
          <ChevronDownIcon className="opacity-70" />
        </button>
        {turnOpen && (
          <MenuPanel align="start" style={{ zIndex: 40 }} width="11rem">
            {BLOCK_TYPES.map((item) => (
              <MenuItem
                active={item.id === activeType}
                key={item.id}
                onClick={() => turnInto(item.id)}
              >
                <span className="flex items-center gap-2">
                  <SlashItemIcon id={item.id} />
                  {item.label}
                </span>
              </MenuItem>
            ))}
          </MenuPanel>
        )}
      </div>
      <span className="mx-[0.1rem] h-5 w-px bg-border" />
      <button
        aria-label="太字"
        className={cn(
          itemClass(editor.isActive("bold")),
          "grid place-items-center",
        )}
        onMouseDown={(event) => {
          event.preventDefault();
          editor.chain().focus().toggleBold().run();
        }}
        type="button"
      >
        <Bold aria-hidden={true} className="size-4" />
      </button>
      <button
        aria-label="斜体"
        className={cn(
          itemClass(editor.isActive("italic")),
          "grid place-items-center",
        )}
        onMouseDown={(event) => {
          event.preventDefault();
          editor.chain().focus().toggleItalic().run();
        }}
        type="button"
      >
        <Italic aria-hidden={true} className="size-4" />
      </button>
      <button
        aria-label="打ち消し"
        className={cn(
          itemClass(editor.isActive("strike")),
          "grid place-items-center",
        )}
        onMouseDown={(event) => {
          event.preventDefault();
          editor.chain().focus().toggleStrike().run();
        }}
        type="button"
      >
        <Strikethrough aria-hidden={true} className="size-4" />
      </button>
      <button
        aria-label="コード"
        className={cn(
          itemClass(editor.isActive("code")),
          "grid place-items-center",
        )}
        onMouseDown={(event) => {
          event.preventDefault();
          editor.chain().focus().toggleCode().run();
        }}
        type="button"
      >
        <Code aria-hidden={true} className="size-4" />
      </button>
      <button
        aria-label="リンク"
        className={cn(
          itemClass(editor.isActive("link")),
          "grid place-items-center",
        )}
        onMouseDown={(event) => {
          event.preventDefault();
          onLink();
        }}
        type="button"
      >
        <Link aria-hidden={true} className="size-4" />
      </button>
    </div>
  );
}

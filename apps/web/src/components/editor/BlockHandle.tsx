import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { IconButton } from "../ui/IconButton.tsx";
import { CommandMenuList } from "./CommandMenuList.tsx";
import { readSlashQuery, SLASH_ITEMS, type SlashCommandHandlers } from "./slash-items.ts";

type Pos = { top: number; left: number };

function readHandlePos(editor: Editor): Pos | null {
  const { empty, $from } = editor.state.selection;
  if (!empty || readSlashQuery(editor)) return null;
  if (!$from.parent.isTextblock) return null;

  const start = $from.start();
  const coords = editor.view.coordsAtPos(start);
  const wrap = editor.view.dom.getBoundingClientRect();
  const scroller = editor.view.dom.closest(".rich-editor-content");
  if (scroller) {
    const rect = scroller.getBoundingClientRect();
    if (coords.top < rect.top + 4 || coords.top > rect.bottom - 8) return null;
  }

  return {
    top: coords.top + (coords.bottom - coords.top) / 2 - 12,
    left: wrap.left + 6,
  };
}

type Props = {
  editor: Editor;
  handlers: SlashCommandHandlers;
};

export function BlockHandle({ editor, handlers }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const sync = () => {
      const next = readHandlePos(editor);
      setPos(next);
      if (!next) {
        setOpen(false);
        setIndex(0);
      }
    };
    editor.on("update", sync);
    editor.on("selectionUpdate", sync);
    const scroller = editor.view.dom.closest(".rich-editor-content");
    scroller?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    sync();
    return () => {
      editor.off("update", sync);
      editor.off("selectionUpdate", sync);
      scroller?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
    };
  }, [editor]);

  useEffect(() => {
    if (!open) return;

    function onPointer(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((value) => (value + 1) % SLASH_ITEMS.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((value) => (value - 1 + SLASH_ITEMS.length) % SLASH_ITEMS.length);
        return;
      }
      if (event.key === "Enter") {
        const item = SLASH_ITEMS[index];
        if (!item) return;
        event.preventDefault();
        item.run(editor, handlers);
        setOpen(false);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [editor, handlers, index, open]);

  if (!pos) return null;

  return (
    <div ref={rootRef} className="fixed z-[25]" style={{ top: pos.top, left: pos.left }}>
      <IconButton
        variant="outline"
        size="sm"
        className="aria-expanded:bg-surface aria-expanded:text-ink"
        aria-label="ブロックコマンド"
        aria-expanded={open}
        onMouseDown={(event) => {
          event.preventDefault();
          setOpen((value) => !value);
          setIndex(0);
        }}
      >
        +
      </IconButton>
      {open && (
        <CommandMenuList
          items={SLASH_ITEMS}
          activeIndex={index}
          label="ブロックコマンド"
          style={{ position: "absolute", left: "calc(100% + 6px)", top: 0 }}
          onPick={(item) => {
            item.run(editor, handlers);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

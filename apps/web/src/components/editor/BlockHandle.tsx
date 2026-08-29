import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { GripIcon, PlusIcon } from "../ui/icons.tsx";
import { CommandMenuList } from "./CommandMenuList.tsx";
import {
  readSlashQuery,
  SLASH_ITEMS,
  type SlashCommandHandlers,
} from "./slash-items.ts";

type Props = {
  editor: Editor;
  handlers: SlashCommandHandlers;
};

export function BlockHandle({ editor, handlers }: Props) {
  const handleRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [slashOpen, setSlashOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(
    null,
  );

  useEffect(() => {
    const sync = () => setSlashOpen(Boolean(readSlashQuery(editor)));
    editor.on("update", sync);
    editor.on("selectionUpdate", sync);
    sync();
    return () => {
      editor.off("update", sync);
      editor.off("selectionUpdate", sync);
    };
  }, [editor]);

  useEffect(() => {
    if (!open) return;

    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      if (
        handleRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
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
        setIndex(
          (value) => (value - 1 + SLASH_ITEMS.length) % SLASH_ITEMS.length,
        );
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

  function toggleMenu() {
    const rect = handleRef.current?.getBoundingClientRect();
    setMenuPos(
      rect ? { left: rect.right + 6, top: rect.top } : { left: 0, top: 0 },
    );
    setOpen((value) => !value);
    setIndex(0);
  }

  return (
    <>
      <DragHandle
        editor={editor}
        nested={{ edgeDetection: { threshold: -16 } }}
        computePositionConfig={{ placement: "left", strategy: "absolute" }}
        className={cn("rich-block-handle", slashOpen && "hidden")}
      >
        <div ref={handleRef} className="flex items-center text-muted">
          <button
            type="button"
            className="grid size-6 cursor-pointer place-items-center rounded-md border-0 bg-transparent hover:bg-surface hover:text-ink"
            aria-label="ブロックを挿入"
            aria-expanded={open}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleMenu();
            }}
          >
            <PlusIcon className="size-3.5" />
          </button>
          <span
            className="grid size-6 cursor-grab place-items-center rounded-md hover:bg-surface hover:text-ink active:cursor-grabbing"
            aria-hidden
          >
            <GripIcon className="size-3.5" />
          </span>
        </div>
      </DragHandle>
      {open && menuPos && (
        <div ref={menuRef}>
          <CommandMenuList
            items={SLASH_ITEMS}
            activeIndex={index}
            label="ブロックコマンド"
            style={{ left: menuPos.left, top: menuPos.top }}
            onPick={(item) => {
              item.run(editor, handlers);
              setOpen(false);
            }}
          />
        </div>
      )}
    </>
  );
}

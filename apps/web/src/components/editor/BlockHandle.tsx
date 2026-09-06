import { DragHandle } from "@tiptap/extension-drag-handle-react";
import type { Editor } from "@tiptap/react";
import { GripVertical } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { PlusIcon } from "../ui/icons.tsx";
import { CommandMenuList } from "./CommandMenuList.tsx";
import { handleCommandMenuKey } from "./command-menu-key.ts";
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
    if (!open) {
      return;
    }

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
      handleCommandMenuKey(event, {
        hasItem: Boolean(SLASH_ITEMS[index]),
        itemCount: SLASH_ITEMS.length,
        onCycle: setIndex,
        onEnter: () => {
          const item = SLASH_ITEMS[index];
          if (item) {
            item.run(editor, handlers);
            setOpen(false);
          }
        },
        onEscape: () => setOpen(false),
      });
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
        className={cn("rich-block-handle", slashOpen && "hidden")}
        computePositionConfig={{ placement: "left", strategy: "absolute" }}
        editor={editor}
        nested={{ edgeDetection: { threshold: -16 } }}
      >
        <div className="flex items-center text-muted" ref={handleRef}>
          <button
            aria-expanded={open}
            aria-label="ブロックを挿入"
            className="grid size-6 cursor-pointer place-items-center rounded-md border-0 bg-transparent hover:bg-surface hover:text-ink"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleMenu();
            }}
            type="button"
          >
            <PlusIcon className="size-3.5" />
          </button>
          <span
            aria-label="ブロックを移動"
            className="grid size-6 cursor-grab place-items-center rounded-md hover:bg-surface hover:text-ink active:cursor-grabbing"
          >
            <GripVertical aria-hidden={true} className="size-4" />
          </span>
        </div>
      </DragHandle>
      {open && menuPos && (
        <div ref={menuRef}>
          <CommandMenuList
            activeIndex={index}
            items={SLASH_ITEMS}
            label="ブロックコマンド"
            onPick={(item) => {
              item.run(editor, handlers);
              setOpen(false);
            }}
            style={{ left: menuPos.left, top: menuPos.top }}
          />
        </div>
      )}
    </>
  );
}

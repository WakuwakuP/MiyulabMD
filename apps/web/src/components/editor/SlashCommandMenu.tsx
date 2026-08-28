import type { Editor } from "@tiptap/react";
import { useEffect, useMemo, useState } from "react";
import { CommandMenuList } from "./CommandMenuList.tsx";
import { matchesSlashItem, readSlashQuery, SLASH_ITEMS, type SlashCommandHandlers, type SlashItem } from "./slash-items.ts";

type SlashState = {
  query: string;
  from: number;
  to: number;
  left: number;
  top: number;
};

function readSlashState(editor: Editor): SlashState | null {
  const slash = readSlashQuery(editor);
  if (!slash) return null;
  const coords = editor.view.coordsAtPos(slash.from);
  return {
    ...slash,
    left: coords.left,
    top: coords.bottom + 6,
  };
}

type Props = {
  editor: Editor;
  handlers: SlashCommandHandlers;
};

export function SlashCommandMenu({ editor, handlers }: Props) {
  const [state, setState] = useState<SlashState | null>(null);
  const [index, setIndex] = useState(0);

  const items = useMemo(
    () => (state ? SLASH_ITEMS.filter((item) => matchesSlashItem(item, state.query)) : []),
    [state],
  );

  useEffect(() => {
    const sync = () => {
      setState(readSlashState(editor));
      setIndex(0);
    };
    editor.on("update", sync);
    editor.on("selectionUpdate", sync);
    sync();
    return () => {
      editor.off("update", sync);
      editor.off("selectionUpdate", sync);
    };
  }, [editor]);

  useEffect(() => {
    if (!state || items.length === 0) return;

    function apply(item: SlashItem) {
      if (!state) return;
      editor.chain().focus().deleteRange({ from: state.from, to: state.to }).run();
      item.run(editor, handlers);
      setState(null);
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((value) => (value + 1) % items.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((value) => (value - 1 + items.length) % items.length);
        return;
      }
      if (event.key === "Enter") {
        const item = items[index];
        if (!item) return;
        event.preventDefault();
        apply(item);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setState(null);
      }
    }

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editor, handlers, index, items, state]);

  if (!state || items.length === 0) return null;

  return (
    <CommandMenuList
      items={items}
      activeIndex={index}
      label="ブロックを挿入"
      style={{ left: state.left, top: state.top }}
      onPick={(item) => {
        editor.chain().focus().deleteRange({ from: state.from, to: state.to }).run();
        item.run(editor, handlers);
        setState(null);
      }}
    />
  );
}

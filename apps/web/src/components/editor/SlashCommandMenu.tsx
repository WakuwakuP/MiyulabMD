import type { Editor } from "@tiptap/react";
import { useEffect, useMemo, useState } from "react";

export type SlashCommandHandlers = {
  onImage: () => void;
  onYoutube: () => void;
  onOgCard: () => void;
};

type SlashItem = {
  id: string;
  label: string;
  hint: string;
  aliases: string[];
  run: (editor: Editor, handlers: SlashCommandHandlers) => void;
};

const ITEMS: SlashItem[] = [
  {
    id: "h1",
    label: "見出し 1",
    hint: "大きなタイトル",
    aliases: ["h1", "heading"],
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    id: "h2",
    label: "見出し 2",
    hint: "セクション",
    aliases: ["h2", "heading"],
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    id: "h3",
    label: "見出し 3",
    hint: "小見出し",
    aliases: ["h3", "heading"],
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    id: "bullet",
    label: "箇条書き",
    hint: "リスト",
    aliases: ["ul", "list", "bullet"],
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    id: "ordered",
    label: "番号付きリスト",
    hint: "手順",
    aliases: ["ol", "numbered"],
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    id: "quote",
    label: "引用",
    hint: "引用ブロック",
    aliases: ["quote", "blockquote"],
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    id: "code",
    label: "コード",
    hint: "コードブロック",
    aliases: ["code", "pre"],
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    id: "hr",
    label: "区切り線",
    hint: "水平線",
    aliases: ["hr", "divider"],
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: "image",
    label: "画像",
    hint: "アップロード",
    aliases: ["image", "img", "photo"],
    run: (_editor, handlers) => handlers.onImage(),
  },
  {
    id: "youtube",
    label: "YouTube",
    hint: "動画を埋め込む",
    aliases: ["youtube", "video"],
    run: (_editor, handlers) => handlers.onYoutube(),
  },
  {
    id: "og",
    label: "リンクカード",
    hint: "OGP",
    aliases: ["ogp", "card", "link"],
    run: (_editor, handlers) => handlers.onOgCard(),
  },
];

type SlashState = {
  query: string;
  from: number;
  to: number;
  left: number;
  top: number;
};

function readSlashState(editor: Editor): SlashState | null {
  const { empty, $from } = editor.state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const text = $from.parent.textBetween(0, $from.parentOffset, undefined, "\uFFFC");
  const match = /(^| )\/([^\s/]*)$/.exec(text);
  if (!match) return null;

  const query = match[2] ?? "";
  const from = $from.pos - query.length - 1;
  const coords = editor.view.coordsAtPos(from);
  return {
    query,
    from,
    to: $from.pos,
    left: coords.left,
    top: coords.bottom + 6,
  };
}

function matchesItem(item: SlashItem, query: string): boolean {
  const needle = query.toLowerCase();
  if (!needle) return true;
  return item.label.includes(query) || item.aliases.some((alias) => alias.includes(needle));
}

type Props = {
  editor: Editor;
  handlers: SlashCommandHandlers;
};

export function SlashCommandMenu({ editor, handlers }: Props) {
  const [state, setState] = useState<SlashState | null>(null);
  const [index, setIndex] = useState(0);

  const items = useMemo(
    () => (state ? ITEMS.filter((item) => matchesItem(item, state.query)) : []),
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
    <div className="slash-menu" role="listbox" aria-label="ブロックを挿入" style={{ left: state.left, top: state.top }}>
      {items.map((item, itemIndex) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={itemIndex === index}
          className={itemIndex === index ? "is-active" : undefined}
          onMouseDown={(event) => {
            event.preventDefault();
            editor.chain().focus().deleteRange({ from: state.from, to: state.to }).run();
            item.run(editor, handlers);
            setState(null);
          }}
        >
          <strong>{item.label}</strong>
          <span>{item.hint}</span>
        </button>
      ))}
    </div>
  );
}

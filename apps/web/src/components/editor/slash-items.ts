import type { Editor } from "@tiptap/react";

export type SlashCommandHandlers = {
  onImage: () => void;
  onYoutube: () => void;
  onOgCard: () => void;
};

export type SlashItem = {
  id: string;
  label: string;
  hint: string;
  aliases: string[];
  run: (editor: Editor, handlers: SlashCommandHandlers) => void;
};

export const SLASH_ITEMS: SlashItem[] = [
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

export function matchesSlashItem(item: SlashItem, query: string): boolean {
  const needle = query.toLowerCase();
  if (!needle) return true;
  return item.label.includes(query) || item.aliases.some((alias) => alias.includes(needle));
}

export function readSlashQuery(editor: Editor): { query: string; from: number; to: number } | null {
  const { empty, $from } = editor.state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const text = $from.parent.textBetween(0, $from.parentOffset, undefined, "\uFFFC");
  const match = /(^| )\/([^\s/]*)$/.exec(text);
  if (!match) return null;
  const query = match[2] ?? "";
  return { query, from: $from.pos - query.length - 1, to: $from.pos };
}

import type { Editor } from "@tiptap/react";

export type SlashCommandHandlers = {
  onImage: () => void;
  onYoutube: () => void;
  onOgCard: () => void;
};

export const SLASH_GROUPS = [
  { id: "basic", label: "基本" },
  { id: "block", label: "ブロック" },
  { id: "media", label: "メディア" },
] as const;

export type SlashGroup = (typeof SLASH_GROUPS)[number]["id"];

export type BlockType =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "bullet"
  | "ordered"
  | "quote"
  | "code";

export const BLOCK_TYPES: { id: BlockType; label: string }[] = [
  { id: "paragraph", label: "テキスト" },
  { id: "h1", label: "見出し 1" },
  { id: "h2", label: "見出し 2" },
  { id: "h3", label: "見出し 3" },
  { id: "bullet", label: "箇条書き" },
  { id: "ordered", label: "番号付きリスト" },
  { id: "quote", label: "引用" },
  { id: "code", label: "コード" },
];

export type SlashItem = {
  id: string;
  label: string;
  hint: string;
  group: SlashGroup;
  aliases: string[];
  run: (editor: Editor, handlers: SlashCommandHandlers) => void;
};

export function applyBlockType(editor: Editor, type: BlockType): void {
  const chain = editor.chain().focus().clearNodes();
  switch (type) {
    case "paragraph":
      chain.setParagraph().run();
      return;
    case "h1":
      chain.setHeading({ level: 1 }).run();
      return;
    case "h2":
      chain.setHeading({ level: 2 }).run();
      return;
    case "h3":
      chain.setHeading({ level: 3 }).run();
      return;
    case "bullet":
      chain.toggleBulletList().run();
      return;
    case "ordered":
      chain.toggleOrderedList().run();
      return;
    case "quote":
      chain.toggleBlockquote().run();
      return;
    case "code":
      chain.toggleCodeBlock().run();
      return;
  }
}

export function currentBlockType(editor: Editor): BlockType {
  if (editor.isActive("heading", { level: 1 })) return "h1";
  if (editor.isActive("heading", { level: 2 })) return "h2";
  if (editor.isActive("heading", { level: 3 })) return "h3";
  if (editor.isActive("bulletList")) return "bullet";
  if (editor.isActive("orderedList")) return "ordered";
  if (editor.isActive("blockquote")) return "quote";
  if (editor.isActive("codeBlock")) return "code";
  return "paragraph";
}

export function blockTypeLabel(type: BlockType): string {
  return BLOCK_TYPES.find((item) => item.id === type)?.label ?? "テキスト";
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    id: "paragraph",
    label: "テキスト",
    hint: "本文",
    group: "basic",
    aliases: ["text", "p", "paragraph"],
    run: (editor) => applyBlockType(editor, "paragraph"),
  },
  {
    id: "h1",
    label: "見出し 1",
    hint: "大きなタイトル",
    group: "basic",
    aliases: ["h1", "heading"],
    run: (editor) => applyBlockType(editor, "h1"),
  },
  {
    id: "h2",
    label: "見出し 2",
    hint: "セクション",
    group: "basic",
    aliases: ["h2", "heading"],
    run: (editor) => applyBlockType(editor, "h2"),
  },
  {
    id: "h3",
    label: "見出し 3",
    hint: "小見出し",
    group: "basic",
    aliases: ["h3", "heading"],
    run: (editor) => applyBlockType(editor, "h3"),
  },
  {
    id: "bullet",
    label: "箇条書き",
    hint: "リスト",
    group: "block",
    aliases: ["ul", "list", "bullet"],
    run: (editor) => applyBlockType(editor, "bullet"),
  },
  {
    id: "ordered",
    label: "番号付きリスト",
    hint: "手順",
    group: "block",
    aliases: ["ol", "numbered"],
    run: (editor) => applyBlockType(editor, "ordered"),
  },
  {
    id: "quote",
    label: "引用",
    hint: "引用ブロック",
    group: "block",
    aliases: ["quote", "blockquote"],
    run: (editor) => applyBlockType(editor, "quote"),
  },
  {
    id: "code",
    label: "コード",
    hint: "コードブロック",
    group: "block",
    aliases: ["code", "pre"],
    run: (editor) => applyBlockType(editor, "code"),
  },
  {
    id: "hr",
    label: "区切り線",
    hint: "水平線",
    group: "block",
    aliases: ["hr", "divider"],
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    id: "image",
    label: "画像",
    hint: "アップロード",
    group: "media",
    aliases: ["image", "img", "photo"],
    run: (_editor, handlers) => handlers.onImage(),
  },
  {
    id: "youtube",
    label: "YouTube",
    hint: "動画を埋め込む",
    group: "media",
    aliases: ["youtube", "video"],
    run: (_editor, handlers) => handlers.onYoutube(),
  },
  {
    id: "og",
    label: "リンクカード",
    hint: "OGP",
    group: "media",
    aliases: ["ogp", "card", "link"],
    run: (_editor, handlers) => handlers.onOgCard(),
  },
];

export function matchesSlashItem(item: SlashItem, query: string): boolean {
  const needle = query.toLowerCase();
  if (!needle) return true;
  return (
    item.label.includes(query) ||
    item.aliases.some((alias) => alias.includes(needle))
  );
}

export function readSlashQuery(
  editor: Editor,
): { query: string; from: number; to: number } | null {
  const { empty, $from } = editor.state.selection;
  if (!empty || !$from.parent.isTextblock) return null;
  const text = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    "\uFFFC",
  );
  const match = /(^| )\/([^\s/]*)$/.exec(text);
  if (!match) return null;
  const query = match[2] ?? "";
  return { query, from: $from.pos - query.length - 1, to: $from.pos };
}

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
  if (editor.isActive("heading", { level: 1 })) {
    return "h1";
  }
  if (editor.isActive("heading", { level: 2 })) {
    return "h2";
  }
  if (editor.isActive("heading", { level: 3 })) {
    return "h3";
  }
  if (editor.isActive("bulletList")) {
    return "bullet";
  }
  if (editor.isActive("orderedList")) {
    return "ordered";
  }
  if (editor.isActive("blockquote")) {
    return "quote";
  }
  if (editor.isActive("codeBlock")) {
    return "code";
  }
  return "paragraph";
}

export function blockTypeLabel(type: BlockType): string {
  return BLOCK_TYPES.find((item) => item.id === type)?.label ?? "テキスト";
}

export const SLASH_ITEMS: SlashItem[] = [
  {
    aliases: ["text", "p", "paragraph"],
    group: "basic",
    hint: "本文",
    id: "paragraph",
    label: "テキスト",
    run: (editor) => applyBlockType(editor, "paragraph"),
  },
  {
    aliases: ["h1", "heading"],
    group: "basic",
    hint: "大きなタイトル",
    id: "h1",
    label: "見出し 1",
    run: (editor) => applyBlockType(editor, "h1"),
  },
  {
    aliases: ["h2", "heading"],
    group: "basic",
    hint: "セクション",
    id: "h2",
    label: "見出し 2",
    run: (editor) => applyBlockType(editor, "h2"),
  },
  {
    aliases: ["h3", "heading"],
    group: "basic",
    hint: "小見出し",
    id: "h3",
    label: "見出し 3",
    run: (editor) => applyBlockType(editor, "h3"),
  },
  {
    aliases: ["ul", "list", "bullet"],
    group: "block",
    hint: "リスト",
    id: "bullet",
    label: "箇条書き",
    run: (editor) => applyBlockType(editor, "bullet"),
  },
  {
    aliases: ["ol", "numbered"],
    group: "block",
    hint: "手順",
    id: "ordered",
    label: "番号付きリスト",
    run: (editor) => applyBlockType(editor, "ordered"),
  },
  {
    aliases: ["quote", "blockquote"],
    group: "block",
    hint: "引用ブロック",
    id: "quote",
    label: "引用",
    run: (editor) => applyBlockType(editor, "quote"),
  },
  {
    aliases: ["code", "pre"],
    group: "block",
    hint: "コードブロック",
    id: "code",
    label: "コード",
    run: (editor) => applyBlockType(editor, "code"),
  },
  {
    aliases: ["hr", "divider"],
    group: "block",
    hint: "水平線",
    id: "hr",
    label: "区切り線",
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    aliases: ["table", "表"],
    group: "block",
    hint: "テーブル",
    id: "table",
    label: "表",
    run: (editor) =>
      editor
        .chain()
        .focus()
        .insertTable({ cols: 3, rows: 3, withHeaderRow: true })
        .run(),
  },
  {
    aliases: ["image", "img", "photo"],
    group: "media",
    hint: "アップロード",
    id: "image",
    label: "画像",
    run: (_editor, handlers) => handlers.onImage(),
  },
  {
    aliases: ["youtube", "video"],
    group: "media",
    hint: "動画を埋め込む",
    id: "youtube",
    label: "YouTube",
    run: (_editor, handlers) => handlers.onYoutube(),
  },
  {
    aliases: ["ogp", "card", "link"],
    group: "media",
    hint: "OGP",
    id: "og",
    label: "リンクカード",
    run: (_editor, handlers) => handlers.onOgCard(),
  },
];

export function matchesSlashItem(item: SlashItem, query: string): boolean {
  const needle = query.toLowerCase();
  if (!needle) {
    return true;
  }
  return (
    item.label.includes(query) ||
    item.aliases.some((alias) => alias.includes(needle))
  );
}

export function readSlashQuery(
  editor: Editor,
): { query: string; from: number; to: number } | null {
  const { empty, $from } = editor.state.selection;
  if (!(empty && $from.parent.isTextblock)) {
    return null;
  }
  const text = $from.parent.textBetween(
    0,
    $from.parentOffset,
    undefined,
    "\uFFFC",
  );
  const match = /(^| )\/([^\s/]*)$/.exec(text);
  if (!match) {
    return null;
  }
  const query = match[2] ?? "";
  return { from: $from.pos - query.length - 1, query, to: $from.pos };
}

export const EDITOR_MODES = ["split", "preview", "source", "rich"] as const;
export type EditorMode = (typeof EDITOR_MODES)[number];

export const EDITOR_MODE_LABELS: Record<EditorMode, string> = {
  split: "分割",
  preview: "プレビュー",
  source: "テキスト",
  rich: "リッチ",
};

const STORAGE_KEY = "miyulabmd:editor-mode";

export function isEditorMode(value: string): value is EditorMode {
  return (EDITOR_MODES as readonly string[]).includes(value);
}

export function readEditorMode(): EditorMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? "";
    return isEditorMode(stored) ? stored : "split";
  } catch {
    return "split";
  }
}

export function writeEditorMode(mode: EditorMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

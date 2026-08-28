export const EDITOR_MODES = ["split", "preview", "source", "rich"] as const;
export type EditorMode = (typeof EDITOR_MODES)[number];

export const EDIT_MODES = ["split", "source", "rich"] as const;
export type EditMode = (typeof EDIT_MODES)[number];

export const EDITOR_MODE_LABELS: Record<EditorMode, string> = {
  split: "分割",
  preview: "プレビュー",
  source: "テキスト",
  rich: "リッチ",
};

const STORAGE_KEY = "miyulabmd:editor-mode";
const LAST_EDIT_KEY = "miyulabmd:editor-edit-mode";

export function isEditorMode(value: string): value is EditorMode {
  return (EDITOR_MODES as readonly string[]).includes(value);
}

export function isEditMode(value: string): value is EditMode {
  return (EDIT_MODES as readonly string[]).includes(value);
}

export function readEditorMode(): EditorMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? "";
    return isEditorMode(stored) ? stored : "preview";
  } catch {
    return "preview";
  }
}

export function readLastEditMode(): EditMode {
  try {
    const stored = localStorage.getItem(LAST_EDIT_KEY) ?? "";
    if (isEditMode(stored)) return stored;
    const current = localStorage.getItem(STORAGE_KEY) ?? "";
    return isEditMode(current) ? current : "split";
  } catch {
    return "split";
  }
}

export function writeEditorMode(mode: EditorMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
    if (isEditMode(mode)) {
      localStorage.setItem(LAST_EDIT_KEY, mode);
    }
  } catch {
    // ignore
  }
}

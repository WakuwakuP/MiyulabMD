import { useEffect, useRef, useState } from "react";
import {
  EDIT_MODES,
  EDITOR_MODE_LABELS,
  isEditMode,
  readLastEditMode,
  type EditMode,
  type EditorMode,
} from "../../lib/editor-mode.ts";

type Props = {
  value: EditorMode;
  canEdit: boolean;
  onChange: (mode: EditorMode) => void;
};

export function EditorModeSwitch({ value, canEdit, onChange }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const editing = isEditMode(value);

  useEffect(() => {
    if (!menuOpen) return;

    function handlePointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!editing) setMenuOpen(false);
  }, [editing]);

  function chooseEdit(mode: EditMode) {
    onChange(mode);
    setMenuOpen(false);
  }

  if (!canEdit) return null;

  return (
    <div className="mode-switch-wrap" ref={rootRef}>
      {editing && (
        <button
          type="button"
          className="header-secondary"
          onClick={() => {
            setMenuOpen(false);
            onChange("preview");
          }}
        >
          閲覧
        </button>
      )}
      <button
        type="button"
        className={editing ? "header-secondary is-editing" : "header-secondary"}
        aria-haspopup={editing ? "menu" : undefined}
        aria-expanded={editing ? menuOpen : undefined}
        onClick={() => {
          if (!editing) {
            onChange(readLastEditMode());
            return;
          }
          setMenuOpen((open) => !open);
        }}
      >
        編集
        {editing && <span aria-hidden>▾</span>}
      </button>
      {menuOpen && editing && (
        <div className="mode-switch-menu" role="menu">
          {EDIT_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              role="menuitem"
              className={value === mode ? "is-active" : undefined}
              onClick={() => chooseEdit(mode)}
            >
              {EDITOR_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  );
}

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
      <div className="mode-switch" role="group" aria-label="表示モード">
        <button
          type="button"
          aria-pressed={!editing}
          className={editing ? undefined : "is-active"}
          onClick={() => {
            setMenuOpen(false);
            onChange("preview");
          }}
        >
          <EyeIcon />
          View
        </button>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-pressed={editing}
          className={editing ? "is-active" : undefined}
          onClick={() => {
            if (!editing) {
              onChange(readLastEditMode());
              return;
            }
            setMenuOpen((open) => !open);
          }}
        >
          <PencilIcon />
          Edit
        </button>
      </div>
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

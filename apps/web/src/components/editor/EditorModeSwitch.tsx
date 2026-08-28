import { EDITOR_MODE_LABELS, EDITOR_MODES, type EditorMode } from "../../lib/editor-mode.ts";

type Props = {
  value: EditorMode;
  onChange: (mode: EditorMode) => void;
};

export function EditorModeSwitch({ value, onChange }: Props) {
  return (
    <div className="mode-switch" role="radiogroup" aria-label="編集モード">
      {EDITOR_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          className={value === mode ? "is-active" : undefined}
          onClick={() => onChange(mode)}
        >
          {EDITOR_MODE_LABELS[mode]}
        </button>
      ))}
    </div>
  );
}

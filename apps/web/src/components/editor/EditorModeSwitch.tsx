import { useRef, useState } from "react";
import { useDismiss } from "../../hooks/use-dismiss.ts";
import {
  EDIT_MODES,
  EDITOR_MODE_LABELS,
  isEditMode,
  readLastEditMode,
  type EditMode,
  type EditorMode,
} from "../../lib/editor-mode.ts";
import { MenuItem, MenuPanel } from "../ui/Menu.tsx";
import { SegmentedControl, SegmentedWrap } from "../ui/SegmentedControl.tsx";

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
  useDismiss(menuOpen, () => setMenuOpen(false), rootRef);

  if (!canEdit) return null;

  function chooseEdit(mode: EditMode) {
    onChange(mode);
    setMenuOpen(false);
  }

  return (
    <div ref={rootRef}>
      <SegmentedWrap>
        <SegmentedControl
          label="表示モード"
          items={[
            {
              value: "preview",
              label: (
                <>
                  <EyeIcon />
                  View
                </>
              ),
              pressed: !editing,
              onClick: () => {
                setMenuOpen(false);
                onChange("preview");
              },
            },
            {
              value: "edit",
              label: (
                <>
                  <PencilIcon />
                  Edit
                </>
              ),
              pressed: editing,
              hasPopup: true,
              expanded: menuOpen,
              onClick: () => {
                if (!editing) {
                  onChange(readLastEditMode());
                  return;
                }
                setMenuOpen((open) => !open);
              },
            },
          ]}
        />
        {menuOpen && editing && (
          <MenuPanel align="end">
            {EDIT_MODES.map((mode) => (
              <MenuItem key={mode} active={value === mode} onClick={() => chooseEdit(mode)}>
                {EDITOR_MODE_LABELS[mode]}
              </MenuItem>
            ))}
          </MenuPanel>
        )}
      </SegmentedWrap>
    </div>
  );
}

import { useRef, useState } from "react";
import { useDismiss } from "../../hooks/use-dismiss.ts";
import {
  EDIT_MODES,
  EDITOR_MODE_LABELS,
  type EditMode,
  type EditorMode,
  isEditMode,
  readLastEditMode,
} from "../../lib/editor-mode.ts";
import { ChevronDownIcon, EyeIcon, PencilIcon } from "../ui/icons.tsx";
import { MenuItem, MenuPanel } from "../ui/Menu.tsx";
import { SegmentedWrap, Switch } from "../ui/Switch.tsx";

type Props = {
  value: EditorMode;
  canEdit: boolean;
  onChange: (mode: EditorMode) => void;
};

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
        <Switch
          label="表示モード"
          size="md"
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
                  <ChevronDownIcon className="opacity-70" />
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
              <MenuItem
                key={mode}
                active={value === mode}
                onClick={() => chooseEdit(mode)}
              >
                {EDITOR_MODE_LABELS[mode]}
              </MenuItem>
            ))}
          </MenuPanel>
        )}
      </SegmentedWrap>
    </div>
  );
}

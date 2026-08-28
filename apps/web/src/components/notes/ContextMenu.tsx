import { useEffect } from "react";
import { MenuFixed, MenuItem } from "../ui/Menu.tsx";

export type ContextMenuItem = {
  label: string;
  danger?: boolean;
  onSelect: () => void;
};

type Props = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

export function ContextMenu({ x, y, items, onClose }: Props) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function handlePointer() {
      onClose();
    }
    window.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handlePointer, true);
    const timer = window.setTimeout(() => {
      window.addEventListener("click", handlePointer);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("click", handlePointer);
      window.removeEventListener("scroll", handlePointer, true);
    };
  }, [onClose]);

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <MenuFixed x={x} y={y}>
        {items.map((item) => (
          <MenuItem
            key={item.label}
            danger={item.danger}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {item.label}
          </MenuItem>
        ))}
      </MenuFixed>
    </div>
  );
}

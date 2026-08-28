import { useEffect } from "react";

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
    <ul
      className="context-menu"
      style={{ left: x, top: y }}
      role="menu"
      onClick={(event) => event.stopPropagation()}
    >
      {items.map((item) => (
        <li key={item.label}>
          <button
            type="button"
            role="menuitem"
            className={item.danger ? "is-danger" : undefined}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}

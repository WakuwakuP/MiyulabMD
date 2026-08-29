import { type CSSProperties, useEffect, useRef } from "react";
import { cn } from "../../lib/cn.ts";
import type { SlashItem } from "./slash-items.ts";

type Props = {
  items: SlashItem[];
  activeIndex: number;
  label: string;
  style?: CSSProperties;
  onPick: (item: SlashItem) => void;
};

export function CommandMenuList({
  items,
  activeIndex,
  label,
  style,
  onPick,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    selected?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div
      ref={listRef}
      className="fixed z-40 max-h-72 min-w-64 overflow-auto rounded-[10px] border border-border bg-canvas p-[0.35rem] shadow-menu"
      role="listbox"
      aria-label={label}
      style={style}
    >
      {items.map((item, itemIndex) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={itemIndex === activeIndex}
          className={cn(
            "grid w-full cursor-pointer gap-[0.1rem] rounded-lg border-0 bg-transparent px-[0.65rem] py-[0.45rem] text-left",
            "hover:bg-surface",
            itemIndex === activeIndex && "bg-surface",
          )}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(item);
          }}
        >
          <strong>{item.label}</strong>
          <span className="text-[0.8rem] text-muted">{item.hint}</span>
        </button>
      ))}
    </div>
  );
}

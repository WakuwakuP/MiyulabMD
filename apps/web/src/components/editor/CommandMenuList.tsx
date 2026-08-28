import { useEffect, useRef, type CSSProperties } from "react";
import type { SlashItem } from "./slash-items.ts";

type Props = {
  items: SlashItem[];
  activeIndex: number;
  label: string;
  style?: CSSProperties;
  onPick: (item: SlashItem) => void;
};

export function CommandMenuList({ items, activeIndex, label, style, onPick }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const selected = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    selected?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div ref={listRef} className="slash-menu" role="listbox" aria-label={label} style={style}>
      {items.map((item, itemIndex) => (
        <button
          key={item.id}
          type="button"
          role="option"
          aria-selected={itemIndex === activeIndex}
          className={itemIndex === activeIndex ? "is-active" : undefined}
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(item);
          }}
        >
          <strong>{item.label}</strong>
          <span>{item.hint}</span>
        </button>
      ))}
    </div>
  );
}

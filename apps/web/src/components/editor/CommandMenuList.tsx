import { type CSSProperties, useEffect, useRef } from "react";
import { cn } from "../../lib/cn.ts";
import { SlashItemIcon } from "./slash-icons.tsx";
import {
  SLASH_GROUPS,
  type SlashGroup,
  type SlashItem,
} from "./slash-items.ts";

type Props = {
  items: SlashItem[];
  activeIndex: number;
  label: string;
  style?: CSSProperties;
  onPick: (item: SlashItem) => void;
};

function groupLabel(group: SlashGroup): string {
  return SLASH_GROUPS.find((item) => item.id === group)?.label ?? group;
}

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

  let lastGroup: SlashGroup | undefined;

  return (
    <div
      ref={listRef}
      className="fixed z-40 max-h-80 min-w-72 overflow-auto rounded-[10px] border border-border bg-canvas p-[0.35rem] shadow-menu"
      role="listbox"
      aria-label={label}
      style={style}
    >
      {items.map((item, itemIndex) => {
        const showGroup = item.group !== lastGroup;
        lastGroup = item.group;
        return (
          <div key={item.id}>
            {showGroup && (
              <p className="px-[0.65rem] pt-2 pb-1 text-[0.7rem] font-semibold tracking-wide text-muted uppercase">
                {groupLabel(item.group)}
              </p>
            )}
            <button
              type="button"
              role="option"
              aria-selected={itemIndex === activeIndex}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-lg border-0 bg-transparent px-[0.5rem] py-[0.4rem] text-left",
                "hover:bg-surface",
                itemIndex === activeIndex && "bg-surface",
              )}
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(item);
              }}
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border bg-surface text-ink">
                <SlashItemIcon id={item.id} />
              </span>
              <span className="min-w-0">
                <strong className="block text-[0.92rem]">{item.label}</strong>
                <span className="block text-[0.78rem] text-muted">
                  {item.hint}
                </span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

type Item<T extends string> = {
  value: T;
  label: ReactNode;
  pressed?: boolean;
  expanded?: boolean;
  hasPopup?: boolean;
  onClick: () => void;
};

type Props<T extends string> = {
  label: string;
  items: Item<T>[];
};

export function SegmentedControl<T extends string>({ label, items }: Props<T>) {
  return (
    <div
      className="flex min-h-9 items-center gap-[0.15rem] rounded-full border border-border bg-fill p-[0.15rem]"
      role="group"
      aria-label={label}
    >
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={item.pressed}
          aria-haspopup={item.hasPopup ? "menu" : undefined}
          aria-expanded={item.hasPopup ? item.expanded : undefined}
          className={cn(
            "inline-flex cursor-pointer items-center justify-center gap-[0.35rem] rounded-full border-0 bg-transparent px-3 py-[0.28rem] leading-tight text-inherit",
            item.pressed && "bg-canvas shadow-[0_0_0_1px_var(--color-border)]",
          )}
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function SegmentedWrap({ children }: { children: ReactNode }) {
  return <div className="relative">{children}</div>;
}

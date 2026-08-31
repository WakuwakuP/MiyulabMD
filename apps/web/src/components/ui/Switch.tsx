import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";

type Item<T extends string> = {
  value: T;
  label: ReactNode;
  pressed?: boolean;
  expanded?: boolean;
  hasPopup?: boolean;
  onClick: () => void;
  ariaLabel?: string;
};

type Props<T extends string> = {
  label: string;
  items: Item<T>[];
  size?: "sm" | "md";
};

type ThumbRect = {
  left: number;
  width: number;
};

export function Switch<T extends string>({
  label,
  items,
  size = "md",
}: Props<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [thumbRect, setThumbRect] = useState<ThumbRect | null>(null);
  const selectedValue = items.find((item) => item.pressed)?.value;

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !selectedValue) {
      setThumbRect(null);
      return;
    }

    const button = container.querySelector<HTMLButtonElement>(
      `[data-switch-value="${CSS.escape(selectedValue)}"]`,
    );
    if (!button) {
      setThumbRect(null);
      return;
    }

    const update = () => {
      const next = { left: button.offsetLeft, width: button.offsetWidth };
      setThumbRect((prev) =>
        prev && prev.left === next.left && prev.width === next.width
          ? prev
          : next,
      );
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(button);
    return () => observer.disconnect();
  }, [selectedValue]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative inline-flex w-fit items-center gap-[0.15rem] rounded-full border border-border bg-fill p-0.5",
        size === "sm" ? "min-h-8" : "min-h-9",
      )}
      role="group"
      aria-label={label}
    >
      {thumbRect && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0.5 left-0 rounded-full bg-canvas shadow-sm transition-[transform,width] duration-200 ease-out motion-reduce:transition-none"
          style={{
            width: thumbRect.width,
            transform: `translateX(${thumbRect.left}px)`,
          }}
        />
      )}
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          data-switch-value={item.value}
          aria-label={item.ariaLabel}
          aria-pressed={item.pressed}
          aria-haspopup={item.hasPopup ? "menu" : undefined}
          aria-expanded={item.hasPopup ? item.expanded : undefined}
          className={cn(
            "relative z-10 inline-flex cursor-pointer items-center justify-center gap-[0.35rem] rounded-full border-0 bg-transparent leading-tight text-inherit",
            size === "sm" ? "px-2 py-1" : "px-3 py-[0.28rem] max-[900px]:px-2",
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

import type { ReactNode } from "react";
import styles from "./segmented.module.css";

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
    <div className={styles.track} role="group" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          aria-pressed={item.pressed}
          aria-haspopup={item.hasPopup ? "menu" : undefined}
          aria-expanded={item.hasPopup ? item.expanded : undefined}
          className={`${styles.item} ${item.pressed ? styles.active : ""}`}
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function SegmentedWrap({ children }: { children: ReactNode }) {
  return <div className={styles.wrap}>{children}</div>;
}

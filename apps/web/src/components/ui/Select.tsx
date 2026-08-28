import type { SelectHTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

type Props = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, ...props }: Props) {
  return (
    <select
      className={cn(
        "min-w-0 border border-border bg-canvas text-ink",
        "disabled:cursor-default disabled:opacity-65",
        className,
      )}
      {...props}
    />
  );
}

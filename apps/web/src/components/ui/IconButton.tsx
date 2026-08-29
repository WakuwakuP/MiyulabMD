import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

type Variant = "ghost" | "surface" | "outline";
type Size = "sm" | "md";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
};

const variants: Record<Variant, string> = {
  ghost: "border-transparent bg-transparent hover:enabled:bg-row",
  surface: "border-transparent bg-surface",
  outline:
    "border-border bg-canvas text-muted hover:enabled:bg-surface hover:enabled:text-ink",
};

const sizes: Record<Size, string> = {
  sm: "size-6 rounded-md",
  md: "size-8 rounded-full",
};

export function IconButton({
  variant = "ghost",
  size = "md",
  className,
  type = "button",
  children,
  ...props
}: Props) {
  return (
    <button
      type={type}
      className={cn(
        "grid cursor-pointer place-items-center border leading-none",
        "disabled:cursor-default disabled:opacity-65",
        "aria-expanded:text-ink",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

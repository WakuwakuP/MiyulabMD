import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn.ts";

type Variant = "default" | "pill";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  variant?: Variant;
};

const variants: Record<Variant, string> = {
  default: "rounded-lg px-3 py-2.5",
  pill: "rounded-full px-3 py-1.5",
};

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { variant = "default", className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "min-w-0 border border-border bg-canvas text-ink",
        "disabled:cursor-default disabled:opacity-65",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});

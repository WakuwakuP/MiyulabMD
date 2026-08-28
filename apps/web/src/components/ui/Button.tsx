import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

export type ButtonVariant = "outline" | "accent" | "ghost" | "danger";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

const variants: Record<ButtonVariant, string> = {
  outline: "border-border bg-fill text-ink hover:enabled:bg-fill-hover",
  accent: "border-accent bg-accent text-white hover:enabled:brightness-105",
  ghost: "border-transparent bg-transparent text-accent",
  danger: "border-transparent bg-error text-white",
};

export function Button({
  variant = "outline",
  className,
  type = "button",
  children,
  ...props
}: Props) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex min-h-9 cursor-pointer items-center justify-center gap-[0.35rem] rounded-full border px-[0.85rem] py-[0.28rem] leading-tight",
        "disabled:cursor-default disabled:opacity-65",
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

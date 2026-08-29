import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn.ts";
import { Button, type ButtonVariant } from "./Button.tsx";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon: ReactNode;
  label: string;
};

export function HeaderButton({
  variant = "outline",
  icon,
  label,
  className,
  ...props
}: Props) {
  return (
    <Button
      variant={variant}
      aria-label={label}
      className={cn("max-[900px]:min-w-9 max-[900px]:px-2", className)}
      {...props}
    >
      {icon}
      <span className="max-[900px]:hidden">{label}</span>
    </Button>
  );
}

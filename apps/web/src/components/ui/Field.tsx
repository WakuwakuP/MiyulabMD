import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

export function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("grid gap-[0.35rem]", className)}>
      <span className="text-[0.85rem] text-muted">{label}</span>
      {children}
    </label>
  );
}

export function CheckLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <label className={cn("flex items-center gap-[0.45rem]", className)}>{children}</label>;
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex gap-2", className)}>{children}</div>;
}

import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

export function ErrorText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={cn("text-error", className)}>{children}</p>;
}

export function MutedText({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("m-0 text-[0.85rem] text-muted", className)}>{children}</p>
  );
}

export function SectionTitle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        "m-0 mb-2 text-[0.85rem] font-semibold text-muted",
        className,
      )}
    >
      {children}
    </h3>
  );
}

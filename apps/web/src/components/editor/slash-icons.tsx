import type { ReactNode } from "react";
import { cn } from "../../lib/cn.ts";

function Icon({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
      className={cn("size-4", className)}
    >
      {children}
    </svg>
  );
}

export function SlashItemIcon({ id }: { id: string }) {
  switch (id) {
    case "paragraph":
      return (
        <Icon>
          <path d="M4 7h16M4 12h10M4 17h13" />
        </Icon>
      );
    case "h1":
      return (
        <Icon>
          <path d="M5 6v12M13 6v12M5 12h8M17 12v6M17 12c0-2 1.5-3 3-3" />
        </Icon>
      );
    case "h2":
      return (
        <Icon>
          <path d="M4 6v12M11 6v12M4 12h7M15 10.5c.6-1.4 2-2.3 3.5-2.3 1.7 0 3 1.1 3 2.8 0 3.5-6.5 3.2-6.5 7h6.6" />
        </Icon>
      );
    case "h3":
      return (
        <Icon>
          <path d="M4 6v12M11 6v12M4 12h7M15 9.2c.7-1.2 2-2 3.5-2 1.8 0 3 1.2 3 2.6 0 1.3-1 2.2-2.4 2.5 1.6.2 2.8 1.2 2.8 2.7 0 1.6-1.4 2.9-3.4 2.9-1.6 0-3-.8-3.6-2" />
        </Icon>
      );
    case "bullet":
      return (
        <Icon>
          <circle cx="6" cy="7" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="6" cy="17" r="1.2" fill="currentColor" stroke="none" />
          <path d="M10 7h10M10 12h10M10 17h10" />
        </Icon>
      );
    case "ordered":
      return (
        <Icon>
          <path d="M10 7h10M10 12h10M10 17h10M5 6.5h2v4H5M5.2 14.2c.5-.5 1.3-.6 1.8-.2.4.3.5.8.3 1.2L5 18.5h3" />
        </Icon>
      );
    case "quote":
      return (
        <Icon>
          <path d="M7 9c0-2 1.4-3.5 3.2-3.5v3.2c-1 0-1.7.7-1.7 1.6V18H5.2V10.3C5.2 9.5 6 9 7 9Zm8.6 0c0-2 1.4-3.5 3.2-3.5v3.2c-1 0-1.7.7-1.7 1.6V18h-3.3V10.3c0-.8.8-1.3 1.8-1.3Z" />
        </Icon>
      );
    case "code":
      return (
        <Icon>
          <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13 6l-2 12" />
        </Icon>
      );
    case "hr":
      return (
        <Icon>
          <path d="M4 12h16" />
        </Icon>
      );
    case "image":
      return (
        <Icon>
          <rect x="4" y="6" width="16" height="12" rx="2" />
          <circle cx="9" cy="10" r="1.4" />
          <path d="m8 16 3.2-3.2L14 15l2-2 4 3" />
        </Icon>
      );
    case "youtube":
      return (
        <Icon>
          <rect x="3.5" y="7" width="17" height="10" rx="2" />
          <path d="m11 10 4 2-4 2z" fill="currentColor" stroke="none" />
        </Icon>
      );
    case "og":
      return (
        <Icon>
          <path d="M10 13.5 8.6 14.9a3 3 0 0 1-4.2-4.2l3.2-3.2a3 3 0 0 1 4.2 0L13 8.7" />
          <path d="m14 10.5 1.4-1.4a3 3 0 0 1 4.2 4.2l-3.2 3.2a3 3 0 0 1-4.2 0L11 15.3" />
        </Icon>
      );
    default:
      return (
        <Icon>
          <path d="M5 7h14M5 12h10M5 17h12" />
        </Icon>
      );
  }
}

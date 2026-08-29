import { cn } from "../../lib/cn.ts";

type IconProps = {
  className?: string;
};

export function EyeIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
      className={cn("size-4", className)}
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function PencilIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
      className={cn("size-4", className)}
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
    </svg>
  );
}

export function ChevronDownIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={cn("size-3", className)}
    >
      <path d="M12 15.5 6.2 9.7a1 1 0 0 1 1.4-1.4L12 12.7l4.4-4.4a1 1 0 1 1 1.4 1.4Z" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
      className={cn("size-4", className)}
    >
      <path d="M6 6 18 18M18 6 6 18" />
    </svg>
  );
}

export function MoreIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      aria-hidden
      className={className}
    >
      <circle cx="12" cy="6" r="1.7" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" />
      <circle cx="12" cy="18" r="1.7" fill="currentColor" />
    </svg>
  );
}

export function FolderOutlineIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
      className={cn("size-4", className)}
    >
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h4.1l1.7 1.8H18.5A2.5 2.5 0 0 1 21 9.3v7.2a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5Z" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
      className={cn("size-4", className)}
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function GripIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      className={cn("size-4", className)}
    >
      <circle cx="9" cy="7" r="1.35" />
      <circle cx="15" cy="7" r="1.35" />
      <circle cx="9" cy="12" r="1.35" />
      <circle cx="15" cy="12" r="1.35" />
      <circle cx="9" cy="17" r="1.35" />
      <circle cx="15" cy="17" r="1.35" />
    </svg>
  );
}

export function ShareIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden
      className={cn("size-4", className)}
    >
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 6.8 4M15.4 6.5 8.6 10.5" />
    </svg>
  );
}

export function FolderIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden
      className={cn("shrink-0 text-folder", className)}
    >
      <path
        fill="currentColor"
        d="M3.75 6.25A2.25 2.25 0 0 1 6 4h4.1l1.7 1.8H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25H6A2.25 2.25 0 0 1 3.75 18V6.25Z"
      />
    </svg>
  );
}

export function MarkdownIcon({ className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      aria-hidden
      className={cn("shrink-0 text-note", className)}
    >
      <path
        fill="currentColor"
        d="M7 3.5h7.3L19.5 8.7V19.5A1.75 1.75 0 0 1 17.75 21.25H6.25A1.75 1.75 0 0 1 4.5 19.5V5.25A1.75 1.75 0 0 1 6.25 3.5H7Z"
        opacity="0.92"
      />
      <path fill="Canvas" d="M14.1 3.7v5.1h5.1" />
      <path
        fill="Canvas"
        d="M7.4 13.1h1.5l1.15 2.35 1.15-2.35h1.5V18H11.3v-2.55L10.05 18h-.1L8.7 15.45V18H7.4Zm7.15 0h1.45l1.7 2.55V13.1H19.2V18h-1.45l-1.7-2.55V18h-1.5Z"
      />
    </svg>
  );
}

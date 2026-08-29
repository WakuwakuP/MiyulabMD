import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn.ts";
import { IconButton } from "./IconButton.tsx";
import { MoreIcon } from "./icons.tsx";

export function DriveList({ children }: { children: ReactNode }) {
  return (
    <ul className="m-0 list-none overflow-hidden rounded-xl border border-border bg-canvas p-0">
      {children}
    </ul>
  );
}

export function DriveRow({
  href,
  name,
  icon,
  menuOpen,
  onMenu,
}: {
  href: string;
  name: string;
  icon: ReactNode;
  menuOpen: boolean;
  onMenu: (event: MouseEvent) => void;
}) {
  return (
    <li
      className={cn(
        "group flex items-center border-b border-border p-0 last:border-b-0 hover:bg-surface",
        menuOpen && "bg-surface",
      )}
      onContextMenu={onMenu}
    >
      <Link
        to={href}
        className="flex min-h-12 flex-1 items-center gap-[0.7rem] px-[0.9rem] py-[0.55rem] text-inherit no-underline"
      >
        {icon}
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">
          {name}
        </span>
      </Link>
      <IconButton
        className={cn(
          "mr-[0.4rem] size-9 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
          menuOpen && "opacity-100",
        )}
        aria-label={`${name} の操作`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={onMenu}
        onContextMenu={onMenu}
      >
        <MoreIcon />
      </IconButton>
    </li>
  );
}

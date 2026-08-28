import type { SessionUser } from "@miyulabmd/shared";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

type Props = {
  user: SessionUser;
};

export function AccountMenu({ user }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const label = user.displayName?.trim() || user.email;

  useEffect(() => {
    function handlePointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("mousedown", handlePointer);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handlePointer);
      window.removeEventListener("keydown", handleKey);
    };
  }, []);

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        type="button"
        className="account-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="account-avatar" aria-hidden>
          {label.slice(0, 1).toUpperCase()}
        </span>
        <span className="account-name">{label}</span>
      </button>
      {open && (
        <div className="account-menu-panel" role="menu">
          <Link to="/settings" role="menuitem" onClick={() => setOpen(false)}>
            設定
          </Link>
          <a href="/auth/logout" role="menuitem">
            ログアウト
          </a>
        </div>
      )}
    </div>
  );
}

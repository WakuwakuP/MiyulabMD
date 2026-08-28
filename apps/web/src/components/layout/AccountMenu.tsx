import type { SessionUser } from "@miyulabmd/shared";
import { useRef, useState } from "react";
import { useDismiss } from "../../hooks/use-dismiss.ts";
import { colorForEmail } from "../../lib/user-style.ts";
import { Avatar } from "../ui/Avatar.tsx";
import { MenuHeader, MenuItem, MenuPanel, MenuSeparator } from "../ui/Menu.tsx";
import styles from "./account-menu.module.css";

type Props = {
  user: SessionUser;
};

export function AccountMenu({ user }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const label = user.displayName?.trim() || user.email;
  useDismiss(open, () => setOpen(false), rootRef);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar name={label} color={colorForEmail(user.email, user.id)} size="md" />
      </button>
      {open && (
        <MenuPanel width="18rem">
          <MenuHeader name={label} email={user.email}>
            <Avatar name={label} color={colorForEmail(user.email, user.id)} size="lg" />
          </MenuHeader>
          <MenuSeparator />
          <MenuItem to="/settings" onClick={() => setOpen(false)}>
            設定
          </MenuItem>
          <MenuItem href="/auth/logout">ログアウト</MenuItem>
        </MenuPanel>
      )}
    </div>
  );
}

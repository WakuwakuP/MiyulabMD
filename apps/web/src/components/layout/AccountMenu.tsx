import type { SessionUser } from "@miyulabmd/shared";
import { type FormEvent, useRef, useState } from "react";
import { useDismiss } from "../../hooks/use-dismiss.ts";
import type { AuthConfig } from "../../lib/api.ts";
import { colorForEmail } from "../../lib/user-style.ts";
import { Avatar } from "../ui/Avatar.tsx";
import { Button } from "../ui/Button.tsx";
import { Input } from "../ui/Input.tsx";
import {
  MenuHeader,
  MenuItem,
  MenuPanel,
  MenuRow,
  MenuSeparator,
} from "../ui/Menu.tsx";
import { ThemeSwitch } from "./ThemeSwitch.tsx";

const GUEST_LABEL = "ゲスト";

type Props = {
  user: SessionUser | null;
  authConfig: AuthConfig;
};

export function AccountMenu({ user, authConfig }: Props) {
  const [open, setOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState("dev@example.com");
  const rootRef = useRef<HTMLDivElement>(null);
  const label = user?.displayName?.trim() || user?.email || GUEST_LABEL;
  const mockLogin = !user && !authConfig.access && authConfig.mock;
  useDismiss(open, () => setOpen(false), rootRef);

  function handleLoginSubmit(event: FormEvent) {
    event.preventDefault();
    const email = loginEmail.trim();
    if (!email) return;
    window.location.href = `/auth/login?email=${encodeURIComponent(email)}`;
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        className="grid cursor-pointer place-items-center rounded-full border-2 border-transparent bg-transparent p-0 hover:border-soft aria-expanded:border-soft"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Avatar
          name={label}
          color={colorForEmail(user?.email, user?.id)}
          size="md"
        />
      </button>
      {open && (
        <MenuPanel width="18rem">
          <MenuHeader name={label} email={user?.email}>
            <Avatar
              name={label}
              color={colorForEmail(user?.email, user?.id)}
              size="lg"
            />
          </MenuHeader>
          <MenuSeparator />
          <MenuRow>
            <span className="text-[0.85rem] text-muted">テーマ</span>
            <ThemeSwitch />
          </MenuRow>
          <MenuSeparator />
          {user ? (
            <>
              <MenuItem to="/settings" onClick={() => setOpen(false)}>
                設定
              </MenuItem>
              <MenuItem href="/auth/logout">ログアウト</MenuItem>
            </>
          ) : mockLogin ? (
            <form className="grid gap-2 px-4 py-2" onSubmit={handleLoginSubmit}>
              <Input
                variant="pill"
                className="w-full"
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                placeholder="email"
                aria-label="ログイン用メールアドレス"
              />
              <Button variant="outline" type="submit">
                ログイン
              </Button>
            </form>
          ) : (
            <MenuItem href="/auth/login">ログイン</MenuItem>
          )}
        </MenuPanel>
      )}
    </div>
  );
}

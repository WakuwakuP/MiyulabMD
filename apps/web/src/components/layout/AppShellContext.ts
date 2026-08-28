import type { SessionUser } from "@miyulabmd/shared";

export type AppShellContext = {
  user: SessionUser | null;
  userLoading: boolean;
  setUser: (user: SessionUser | null) => void;
};

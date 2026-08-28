import type { SessionUser } from "@miyulabmd/shared";
import type { ReactNode } from "react";

export type HeaderLayout = "page" | "editor";

export type AppShellContext = {
  user: SessionUser | null;
  userLoading: boolean;
  setUser: (user: SessionUser | null) => void;
  setHeader: (header: { title?: string; actions?: ReactNode; layout?: HeaderLayout } | null) => void;
};

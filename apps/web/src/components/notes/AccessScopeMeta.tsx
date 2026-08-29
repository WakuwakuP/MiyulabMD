import { ACCESS_SCOPE_LABELS, type AccessScope } from "@miyulabmd/shared";
import { Globe, Lock, UserPlus, Users } from "lucide-react";
import { cn } from "../../lib/cn.ts";

const SHORT_LABELS: Record<AccessScope, string> = {
  public: "公開",
  signed_in: "ログイン",
  users: "指定",
  self: "自分",
};

const SCOPE_ICONS: Record<AccessScope, typeof Globe> = {
  public: Globe,
  signed_in: Users,
  users: UserPlus,
  self: Lock,
};

type Props = {
  scope: AccessScope;
  className?: string;
};

export function AccessScopeMeta({ scope, className }: Props) {
  const label = ACCESS_SCOPE_LABELS[scope];
  const Icon = SCOPE_ICONS[scope];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-[0.72rem] leading-none",
        scope === "public" && "text-accent",
        scope === "signed_in" && "text-muted",
        scope === "users" && "text-muted",
        scope === "self" && "text-muted/45",
        className,
      )}
      title={label}
      aria-label={label}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span>{SHORT_LABELS[scope]}</span>
    </span>
  );
}

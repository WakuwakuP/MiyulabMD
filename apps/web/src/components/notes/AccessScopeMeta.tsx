import { ACCESS_SCOPE_LABELS, type AccessScope } from "@miyulabmd/shared";
import { Globe, Link, Lock, UserPlus, Users } from "lucide-react";
import { cn } from "../../lib/cn.ts";

const SHORT_LABELS: Record<AccessScope, string> = {
  link: "リンク",
  public: "公開",
  self: "自分",
  signed_in: "ログイン",
  users: "指定",
};

const SCOPE_ICONS: Record<AccessScope, typeof Globe> = {
  link: Link,
  public: Globe,
  self: Lock,
  signed_in: Users,
  users: UserPlus,
};

function scopeTone(scope: AccessScope): string {
  if (scope === "public") {
    return "text-accent";
  }
  if (scope === "self") {
    return "text-muted/45";
  }
  return "text-muted";
}

function ScopeMark({ kind, scope }: { kind: string; scope: AccessScope }) {
  const Icon = SCOPE_ICONS[scope];

  return (
    <span className={cn("inline-flex items-center gap-1", scopeTone(scope))}>
      <Icon aria-hidden={true} className="size-3.5 shrink-0" />
      <span>{kind}</span>
      <span>{SHORT_LABELS[scope]}</span>
    </span>
  );
}

type Props = {
  readScope: AccessScope;
  writeScope: AccessScope;
  className?: string;
};

export function AccessScopeMeta({ readScope, writeScope, className }: Props) {
  const label = `閲覧 ${ACCESS_SCOPE_LABELS[readScope]}、編集 ${ACCESS_SCOPE_LABELS[writeScope]}`;

  return (
    <span
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center gap-2 text-[0.72rem] leading-none",
        className,
      )}
      title={label}
    >
      <ScopeMark kind="閲覧" scope={readScope} />
      <ScopeMark kind="編集" scope={writeScope} />
    </span>
  );
}

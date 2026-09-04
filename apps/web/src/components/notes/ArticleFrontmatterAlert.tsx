import type { ArticleFrontmatterIssue } from "@miyulabmd/shared";
import { ErrorText } from "../ui/Text.tsx";

export function ArticleFrontmatterAlert({
  issues,
}: {
  issues: ArticleFrontmatterIssue[];
}) {
  if (issues.length === 0) return null;
  return (
    <div
      role="alert"
      className="pointer-events-none fixed inset-x-0 z-30 flex justify-center px-3 max-[640px]:px-2 bottom-[calc(100dvh-var(--app-offset-top,0px)-var(--app-height,100dvh))] pb-[env(safe-area-inset-bottom,0px)]"
    >
      <div className="pointer-events-auto max-h-[min(12rem,calc(var(--app-height,100dvh)*0.4))] w-full max-w-[36rem] overflow-y-auto rounded-t-xl border border-b-0 border-border bg-canvas px-3 py-2 shadow-menu">
        <ErrorText className="m-0 text-[0.85rem] font-medium">
          記事メタが不正です
        </ErrorText>
        <ul className="m-0 mt-1 list-disc pl-5 text-[0.85rem] text-error">
          {issues.map((issue) => (
            <li key={`${issue.key ?? ""}:${issue.message}`}>{issue.message}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

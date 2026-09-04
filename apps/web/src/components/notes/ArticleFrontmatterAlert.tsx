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
      className="border-b border-border px-5 py-2 max-[640px]:px-3"
    >
      <ErrorText className="m-0 text-[0.85rem] font-medium">
        記事メタが不正です
      </ErrorText>
      <ul className="m-0 mt-1 list-disc pl-5 text-[0.85rem] text-error">
        {issues.map((issue) => (
          <li key={`${issue.key ?? ""}:${issue.message}`}>{issue.message}</li>
        ))}
      </ul>
    </div>
  );
}

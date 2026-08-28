import { useEffect, useState } from "react";
import { renderMarkdown } from "../../lib/markdown.ts";

type Props = {
  markdown: string;
};

export function MarkdownPreview({ markdown }: Props) {
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    renderMarkdown(markdown)
      .then((result) => {
        if (!cancelled) {
          setHtml(result);
          setError(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHtml("");
          setError("プレビューの生成に失敗しました。");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [markdown]);

  if (error) {
    return <article className="markdown-preview markdown-preview--error">{error}</article>;
  }

  return (
    <article
      className="markdown-preview"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

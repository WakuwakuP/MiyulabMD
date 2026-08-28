import { useEffect, useRef, useState } from "react";
import { renderMarkdown } from "../../lib/markdown.ts";

type Props = {
  markdown: string;
  scrollRatio?: number;
  onScrollRatio?: (ratio: number) => void;
};

function scrollRatioFrom(el: HTMLElement): number {
  const max = el.scrollHeight - el.clientHeight;
  return max <= 0 ? 0 : el.scrollTop / max;
}

export function MarkdownPreview({ markdown, scrollRatio, onScrollRatio }: Props) {
  const articleRef = useRef<HTMLElement>(null);
  const applyingScroll = useRef(false);
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

  useEffect(() => {
    const el = articleRef.current;
    if (!el || scrollRatio == null) return;
    if (Math.abs(scrollRatioFrom(el) - scrollRatio) < 0.004) return;
    applyingScroll.current = true;
    const max = el.scrollHeight - el.clientHeight;
    if (max > 0) el.scrollTop = max * scrollRatio;
    const timer = window.requestAnimationFrame(() => {
      applyingScroll.current = false;
    });
    return () => window.cancelAnimationFrame(timer);
  }, [html, scrollRatio]);

  if (error) {
    return <article className="markdown-preview markdown-preview--error">{error}</article>;
  }

  return (
    <article
      ref={articleRef}
      className="markdown-preview"
      dangerouslySetInnerHTML={{ __html: html }}
      onScroll={(event) => {
        if (applyingScroll.current) return;
        onScrollRatio?.(scrollRatioFrom(event.currentTarget));
      }}
    />
  );
}

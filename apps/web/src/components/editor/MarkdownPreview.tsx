import { useDeferredValue, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";
import { loadOgCards, renderMarkdownHtml } from "../../lib/markdown.ts";
import { embedClass, markdownProseClass } from "../ui/prose.ts";

type Props = {
  markdown: string;
  scrollRatio?: number;
  onScrollRatio?: (ratio: number) => void;
  className?: string;
  documentScroll?: boolean;
};

function scrollRatioFrom(el: HTMLElement): number {
  const max = el.scrollHeight - el.clientHeight;
  return max <= 0 ? 0 : el.scrollTop / max;
}

export function MarkdownPreview({
  markdown,
  scrollRatio,
  onScrollRatio,
  className,
  documentScroll = false,
}: Props) {
  const articleRef = useRef<HTMLElement>(null);
  const applyingScroll = useRef(false);
  const deferredMarkdown = useDeferredValue(markdown);
  const [html, setHtml] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    try {
      const next = renderMarkdownHtml(deferredMarkdown);
      setHtml((prev) => (prev === next ? prev : next));
      setError(null);
    } catch {
      setHtml("");
      setError("プレビューの生成に失敗しました。");
      return;
    }

    void loadOgCards(deferredMarkdown).then((cards) => {
      if (cancelled || cards.size === 0) return;
      const next = renderMarkdownHtml(deferredMarkdown, cards);
      setHtml((prev) => (prev === next ? prev : next));
    });

    return () => {
      cancelled = true;
    };
  }, [deferredMarkdown]);

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

  const shell = cn(
    "markdown-preview min-h-96 overflow-auto rounded-md border border-border bg-surface px-5 py-4",
    !documentScroll &&
      "[[data-layout=editor]_&]:h-full [[data-layout=editor]_&]:min-h-0 [[data-layout=editor]_&]:rounded-none [[data-layout=editor]_&]:border-0",
    documentScroll &&
      "[[data-layout=editor]_&]:overflow-visible [[data-layout=editor]_&]:min-h-0",
    markdownProseClass,
    embedClass,
    className,
  );

  if (error) {
    return <article className={cn(shell, "text-error")}>{error}</article>;
  }

  return (
    <article
      ref={articleRef}
      className={shell}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: rehype-sanitize 済み
      dangerouslySetInnerHTML={{ __html: html }}
      onScroll={(event) => {
        if (applyingScroll.current) return;
        onScrollRatio?.(scrollRatioFrom(event.currentTarget));
      }}
    />
  );
}

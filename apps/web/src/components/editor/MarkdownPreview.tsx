import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
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
  const [enhanced, setEnhanced] = useState<{ md: string; html: string } | null>(
    null,
  );

  const rendered = useMemo(() => {
    try {
      return { html: renderMarkdownHtml(deferredMarkdown), error: null };
    } catch {
      return { html: "", error: "プレビューの生成に失敗しました。" };
    }
  }, [deferredMarkdown]);

  useEffect(() => {
    let cancelled = false;
    void loadOgCards(markdown).then((cards) => {
      if (cancelled || cards.size === 0) return;
      setEnhanced({
        md: markdown,
        html: renderMarkdownHtml(markdown, cards),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [markdown]);

  const html = enhanced?.md === markdown ? enhanced.html : rendered.html;
  const error = rendered.error;

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

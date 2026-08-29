import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/cn.ts";
import {
  extractNoteToc,
  shouldShowPreviewToc,
  type TocEntry,
} from "../../lib/note-toc.ts";
import { MarkdownPreview } from "./MarkdownPreview.tsx";

const previewCardClass =
  "mx-auto my-6 mb-12 h-auto w-[min(calc(100%-2rem),46rem)] rounded-[10px] border-0 bg-canvas px-10 pt-10 pb-16 shadow-preview";

type Props = {
  markdown: string;
  className?: string;
  scrollRatio?: number;
  onScrollRatio?: (ratio: number) => void;
  documentScroll?: boolean;
};

function TocNav({ entries }: { entries: TocEntry[] }) {
  if (entries.length === 0) return null;

  function handleClick(id: string) {
    const target = document.getElementById(id);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <nav
      aria-label="目次"
      className="sticky top-[calc(var(--header-height)+1.5rem)] w-48 shrink-0 self-start pt-2 text-sm"
    >
      <p className="m-0 mb-3 font-semibold text-ink">目次</p>
      <ol className="m-0 list-none space-y-1.5 p-0">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className={cn(
              entry.level === 2 && "pl-3",
              entry.level === 3 && "pl-6",
            )}
          >
            <button
              type="button"
              className="w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left text-muted no-underline hover:text-accent"
              onClick={() => handleClick(entry.id)}
            >
              {entry.text}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PreviewWithToc({
  markdown,
  className,
  scrollRatio,
  onScrollRatio,
  documentScroll = true,
}: Props) {
  const layoutRef = useRef<HTMLDivElement>(null);
  const [showToc, setShowToc] = useState(false);
  const deferredMarkdown = useDeferredValue(markdown);
  const entries = useMemo(
    () => extractNoteToc(deferredMarkdown),
    [deferredMarkdown],
  );

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1200px)");

    function update() {
      const width = layoutRef.current?.clientWidth ?? window.innerWidth;
      setShowToc(media.matches && shouldShowPreviewToc(width));
    }

    update();
    media.addEventListener("change", update);
    const observer = layoutRef.current ? new ResizeObserver(update) : null;
    observer?.observe(layoutRef.current as Element);

    return () => {
      media.removeEventListener("change", update);
      observer?.disconnect();
    };
  }, []);

  const cardClass = cn(previewCardClass, className);

  return (
    <div
      ref={layoutRef}
      className="relative w-full [[data-layout=editor]_&]:min-h-[calc(100dvh-var(--header-height))] [[data-layout=editor]_&]:bg-preview"
    >
      <MarkdownPreview
        markdown={markdown}
        scrollRatio={scrollRatio}
        onScrollRatio={onScrollRatio}
        documentScroll={documentScroll}
        className={cardClass}
      />
      {showToc && entries.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex justify-center">
          <div className="relative w-[min(calc(100%-2rem),46rem)]">
            <div className="pointer-events-auto absolute top-6 left-full ml-8">
              <TocNav entries={entries} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export { previewCardClass };

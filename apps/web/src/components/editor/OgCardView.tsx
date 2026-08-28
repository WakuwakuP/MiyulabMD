import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";
import { fetchOgPreview } from "../../lib/api.ts";
import type { OgPreview } from "../../lib/embeds.ts";
import { MutedText } from "../ui/Text.tsx";

export function OgCardView({ node }: NodeViewProps) {
  const href = String(node.attrs.href ?? "");
  const [card, setCard] = useState<OgPreview | null>(null);
  const [loading, setLoading] = useState(Boolean(href));

  useEffect(() => {
    if (!href) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchOgPreview(href).then((result) => {
      if (cancelled) return;
      setCard(result.ok ? result.data : null);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [href]);

  return (
    <NodeViewWrapper className="my-4">
      <a
        className="flex gap-3 rounded-[10px] border border-border bg-surface p-3 text-inherit no-underline"
        href={href}
        target="_blank"
        rel="noreferrer"
      >
        {card?.image && <img src={card.image} alt="" className="h-20 w-[7.5rem] rounded-md object-cover" />}
        <span>
          <strong>{loading ? "読み込み中…" : card?.title || href}</strong>
          {card?.description && <MutedText className="mt-1">{card.description}</MutedText>}
          {card?.siteName && <small className="mt-1 block text-muted">{card.siteName}</small>}
        </span>
      </a>
    </NodeViewWrapper>
  );
}

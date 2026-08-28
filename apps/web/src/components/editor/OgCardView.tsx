import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/react";
import { useEffect, useState } from "react";
import { fetchOgPreview } from "../../lib/api.ts";
import type { OgPreview } from "../../lib/embeds.ts";

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
    <NodeViewWrapper className="embed-og-wrap">
      <a className="embed-og" href={href} target="_blank" rel="noreferrer">
        {card?.image && <img src={card.image} alt="" />}
        <span>
          <strong>{loading ? "読み込み中…" : card?.title || href}</strong>
          {card?.description && <span className="embed-og-desc">{card.description}</span>}
          {card?.siteName && <small>{card.siteName}</small>}
        </span>
      </a>
    </NodeViewWrapper>
  );
}

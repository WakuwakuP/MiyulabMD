import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import type { MouseEvent } from "react";
import { useEffect, useState } from "react";
import { fetchOgPreview } from "../../lib/api.ts";
import type { OgPreview } from "../../lib/embeds.ts";
import { MutedText } from "../ui/Text.tsx";
import { expandOgCard } from "./extensions/auto-link-card.ts";

const cardClass =
  "flex w-full cursor-pointer gap-3 rounded-[10px] border border-border bg-surface p-3 text-left text-inherit no-underline";

function CardBody({
  href,
  card,
  loading,
}: {
  href: string;
  card: OgPreview | null;
  loading: boolean;
}) {
  return (
    <>
      {card?.image && (
        <img
          src={card.image}
          alt=""
          className="h-20 w-[7.5rem] rounded-md object-cover"
        />
      )}
      <span>
        <strong>{loading ? "読み込み中…" : card?.title || href}</strong>
        {card?.description && (
          <MutedText className="mt-1">{card.description}</MutedText>
        )}
        {card?.siteName && (
          <small className="mt-1 block text-muted">{card.siteName}</small>
        )}
      </span>
    </>
  );
}

export function OgCardView({ node, editor, getPos }: NodeViewProps) {
  const href = String(node.attrs.href ?? "");
  const [card, setCard] = useState<OgPreview | null>(null);
  const [loading, setLoading] = useState(Boolean(href));
  const editable = editor.isEditable;

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

  function expand(event: MouseEvent) {
    if (!editable) return;
    event.preventDefault();
    event.stopPropagation();
    const pos = getPos();
    if (typeof pos !== "number") return;
    const tr = expandOgCard(editor.state, pos);
    if (!tr) return;
    editor.view.dispatch(tr);
    editor.view.focus();
  }

  const body = <CardBody href={href} card={card} loading={loading} />;

  return (
    <NodeViewWrapper className="my-4" data-og-card="">
      {editable ? (
        <div className={cardClass} onClick={expand}>
          {body}
        </div>
      ) : (
        <a className={cardClass} href={href} target="_blank" rel="noreferrer">
          {body}
        </a>
      )}
    </NodeViewWrapper>
  );
}

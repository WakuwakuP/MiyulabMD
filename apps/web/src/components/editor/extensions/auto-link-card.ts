import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export function paragraphStandaloneHref(node: PMNode): string | null {
  if (node.type.name !== "paragraph" || node.childCount === 0) return null;

  let onlyText = true;
  node.forEach((child) => {
    if (!child.isText) onlyText = false;
  });
  if (!onlyText) return null;

  const trimmed = node.textContent.trim();
  if (!trimmed) return null;
  if (/^https?:\/\/[^\s<>]+$/.test(trimmed)) return trimmed;

  if (node.childCount !== 1) return null;
  const child = node.firstChild;
  const link = child?.marks.find((mark) => mark.type.name === "link");
  const href = typeof link?.attrs.href === "string" ? link.attrs.href : "";
  if (href && /^https?:\/\//.test(href) && child?.text?.trim() === trimmed)
    return href;
  return null;
}

export const AutoLinkCard = Extension.create({
  name: "autoLinkCard",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("autoLinkCard"),
        appendTransaction(transactions, _oldState, newState) {
          if (
            !transactions.some(
              (transaction) =>
                transaction.docChanged || transaction.selectionSet,
            )
          ) {
            return null;
          }
          const ogType = newState.schema.nodes.ogCard;
          if (!ogType) return null;

          const { selection, doc } = newState;
          const replacements: Array<{
            from: number;
            to: number;
            href: string;
          }> = [];
          doc.forEach((node, pos) => {
            const href = paragraphStandaloneHref(node);
            if (!href) return;
            const from = pos;
            const to = pos + node.nodeSize;
            if (selection.from < to && selection.to > from) return;
            replacements.push({ from, to, href });
          });
          if (replacements.length === 0) return null;

          let tr = newState.tr;
          for (const { from, to, href } of replacements.reverse()) {
            tr = tr.replaceWith(from, to, ogType.create({ href }));
          }
          return tr;
        },
      }),
    ];
  },
});

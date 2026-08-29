import {
  createAtomBlockMarkdownSpec,
  mergeAttributes,
  Node,
} from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { OgCardView } from "../OgCardView.tsx";

export const OgCard = Node.create({
  name: "ogCard",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      href: { default: "" },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-og-card]" }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, string> }) {
    return ["div", mergeAttributes({ "data-og-card": "" }, HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(OgCardView);
  },

  ...createAtomBlockMarkdownSpec({
    nodeName: "ogCard",
    requiredAttributes: ["href"],
    allowedAttributes: ["href"],
  }),

  renderMarkdown: (node) => {
    const href = typeof node.attrs?.href === "string" ? node.attrs.href : "";
    return href;
  },
});

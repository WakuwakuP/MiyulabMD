import {
  createAtomBlockMarkdownSpec,
  mergeAttributes,
  Node,
} from "@tiptap/core";
import { NodeSelection } from "@tiptap/pm/state";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { OgCardView } from "../OgCardView.tsx";
import { expandOgCard } from "./auto-link-card.ts";

export const OgCard = Node.create({
  addAttributes() {
    return {
      href: { default: "" },
    };
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { selection } = editor.state;
        if (
          !(selection instanceof NodeSelection) ||
          selection.node.type.name !== "ogCard"
        ) {
          return false;
        }
        const tr = expandOgCard(editor.state, selection.from);
        if (!tr) {
          return false;
        }
        editor.view.dispatch(tr);
        return true;
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(OgCardView);
  },
  atom: true,
  draggable: true,
  group: "block",
  name: "ogCard",

  parseHTML() {
    return [{ tag: "div[data-og-card]" }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, string> }) {
    return ["div", mergeAttributes({ "data-og-card": "" }, HTMLAttributes)];
  },

  ...createAtomBlockMarkdownSpec({
    allowedAttributes: ["href"],
    nodeName: "ogCard",
    requiredAttributes: ["href"],
  }),

  renderMarkdown: (node) => {
    const href = typeof node.attrs?.href === "string" ? node.attrs.href : "";
    return href;
  },
});

import Paragraph from "@tiptap/extension-paragraph";
import { escapeMarkdownBlockPrefix } from "../../../lib/rich-markdown-escape.ts";

const EMPTY_PARAGRAPH_MARKDOWN = "&nbsp;";

export const SafeParagraph = Paragraph.extend({
  renderMarkdown: (node, helpers, ctx) => {
    if (!node) return "";
    const content = Array.isArray(node.content) ? node.content : [];
    if (content.length === 0) {
      const previousContent = Array.isArray(ctx?.previousNode?.content) ? ctx.previousNode.content : [];
      return ctx?.previousNode?.type === "paragraph" && previousContent.length === 0
        ? EMPTY_PARAGRAPH_MARKDOWN
        : "";
    }
    return escapeMarkdownBlockPrefix(helpers.renderChildren(content));
  },
});

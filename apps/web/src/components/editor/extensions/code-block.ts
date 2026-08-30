import {
  highlightLanguage,
  parseFenceInfo,
  serializeFenceInfo,
} from "@miyulabmd/markdown";
import { textblockTypeInputRule } from "@tiptap/core";
import {
  CodeBlockLowlight,
  type CodeBlockLowlightOptions,
} from "@tiptap/extension-code-block-lowlight";
import { codeBlockLowlight } from "../../../lib/code-highlight.ts";

const fenceInputRegex = /^```(\S*)[\s\n]$/;
const tildeFenceInputRegex = /^~~~(\S*)[\s\n]$/;

function fenceAttrs(info: string) {
  const parsed = parseFenceInfo(info);
  return {
    language: highlightLanguage(parsed) || parsed.language || null,
    filename: parsed.filename,
  };
}

export const HighlightedCodeBlock = CodeBlockLowlight.extend({
  addOptions() {
    const parent = this.parent?.();
    const options: CodeBlockLowlightOptions = {
      languageClassPrefix: parent?.languageClassPrefix ?? "language-",
      exitOnTripleEnter: parent?.exitOnTripleEnter ?? true,
      exitOnArrowDown: parent?.exitOnArrowDown ?? true,
      exitOnArrowUp: parent?.exitOnArrowUp ?? true,
      defaultLanguage: parent?.defaultLanguage ?? null,
      enableTabIndentation: parent?.enableTabIndentation ?? false,
      tabSize: parent?.tabSize ?? 4,
      HTMLAttributes: parent?.HTMLAttributes ?? {},
      lowlight: codeBlockLowlight,
    };
    return options;
  },

  addAttributes() {
    return {
      language: {
        default: this.options.defaultLanguage,
        parseHTML: (element) => {
          const prefix = this.options.languageClassPrefix ?? "language-";
          const classNames = [
            ...(element.querySelector("code")?.classList ?? []),
          ];
          const raw =
            classNames
              .find((name) => name.startsWith(prefix))
              ?.slice(prefix.length) ?? "";
          return parseFenceInfo(raw).language || null;
        },
        rendered: false,
      },
      filename: {
        default: "",
        parseHTML: (element) => {
          const attr =
            element.getAttribute("data-filename") ??
            element
              .querySelector("[data-filename]")
              ?.getAttribute("data-filename");
          if (attr) return attr;
          const prefix = this.options.languageClassPrefix ?? "language-";
          const classNames = [
            ...(element.querySelector("code")?.classList ?? []),
          ];
          const raw =
            classNames
              .find((name) => name.startsWith(prefix))
              ?.slice(prefix.length) ?? "";
          return parseFenceInfo(raw).filename;
        },
        rendered: false,
      },
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const filename = String(node.attrs.filename ?? "");
    const language = highlightLanguage({
      language: String(node.attrs.language ?? ""),
      filename,
    });
    return [
      "div",
      { class: "md-code", "data-filename": filename || null },
      filename ? ["div", { class: "md-code-filename" }, filename] : "",
      [
        "pre",
        { ...HTMLAttributes, "data-filename": filename || null },
        [
          "code",
          {
            class: language
              ? `${this.options.languageClassPrefix}${language}`
              : null,
          },
          0,
        ],
      ],
    ];
  },

  parseMarkdown: (token, helpers) => {
    if (
      token.raw?.startsWith("```") === false &&
      token.raw?.startsWith("~~~") === false &&
      token.codeBlockStyle !== "indented"
    ) {
      return [];
    }
    return helpers.createNode(
      "codeBlock",
      fenceAttrs(typeof token.lang === "string" ? token.lang : ""),
      token.text ? [helpers.createTextNode(token.text)] : [],
    );
  },

  renderMarkdown: (node, helpers) => {
    const info = serializeFenceInfo({
      language:
        typeof node.attrs?.language === "string" ? node.attrs.language : "",
      filename:
        typeof node.attrs?.filename === "string" ? node.attrs.filename : "",
    });
    if (!node.content) return `\`\`\`${info}\n\n\`\`\``;
    return [`\`\`\`${info}`, helpers.renderChildren(node.content), "```"].join(
      "\n",
    );
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: fenceInputRegex,
        type: this.type,
        getAttributes: (match) => fenceAttrs(match[1] ?? ""),
      }),
      textblockTypeInputRule({
        find: tildeFenceInputRegex,
        type: this.type,
        getAttributes: (match) => fenceAttrs(match[1] ?? ""),
      }),
    ];
  },
});

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
    filename: parsed.filename,
    language: highlightLanguage(parsed) || parsed.language || null,
  };
}

export const HighlightedCodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      filename: {
        default: "",
        parseHTML: (element) => {
          const attr =
            element.getAttribute("data-filename") ??
            element
              .querySelector("[data-filename]")
              ?.getAttribute("data-filename");
          if (attr) {
            return attr;
          }
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
    };
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: fenceInputRegex,
        getAttributes: (match) => fenceAttrs(match[1] ?? ""),
        type: this.type,
      }),
      textblockTypeInputRule({
        find: tildeFenceInputRegex,
        getAttributes: (match) => fenceAttrs(match[1] ?? ""),
        type: this.type,
      }),
    ];
  },
  addOptions() {
    const parent = this.parent?.();
    const options: CodeBlockLowlightOptions = {
      defaultLanguage: parent?.defaultLanguage ?? null,
      enableTabIndentation: parent?.enableTabIndentation ?? false,
      exitOnArrowDown: parent?.exitOnArrowDown ?? true,
      exitOnArrowUp: parent?.exitOnArrowUp ?? true,
      exitOnTripleEnter: parent?.exitOnTripleEnter ?? true,
      HTMLAttributes: parent?.HTMLAttributes ?? {},
      languageClassPrefix: parent?.languageClassPrefix ?? "language-",
      lowlight: codeBlockLowlight,
      tabSize: parent?.tabSize ?? 4,
    };
    return options;
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

  renderHTML({ node, HTMLAttributes }) {
    const filename = String(node.attrs.filename ?? "");
    const language = highlightLanguage({
      filename,
      language: String(node.attrs.language ?? ""),
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

  renderMarkdown: (node, helpers) => {
    const info = serializeFenceInfo({
      filename:
        typeof node.attrs?.filename === "string" ? node.attrs.filename : "",
      language:
        typeof node.attrs?.language === "string" ? node.attrs.language : "",
    });
    if (!node.content) {
      return `\`\`\`${info}\n\n\`\`\``;
    }
    return [`\`\`\`${info}`, helpers.renderChildren(node.content), "```"].join(
      "\n",
    );
  },
});

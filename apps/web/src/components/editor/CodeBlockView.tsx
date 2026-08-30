import {
  highlightLanguage,
  inferLanguageFromFilename,
} from "@miyulabmd/markdown";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { CODE_BLOCK_LANGUAGES } from "../../lib/code-highlight.ts";
import { Input } from "../ui/Input.tsx";
import { Select } from "../ui/Select.tsx";

export function CodeBlockView({
  node,
  updateAttributes,
  editor,
}: NodeViewProps) {
  const language = String(node.attrs.language ?? "");
  const filename = String(node.attrs.filename ?? "");
  const editable = editor.isEditable;
  const highlight = highlightLanguage({ language, filename });
  const languages = CODE_BLOCK_LANGUAGES.includes(language)
    ? CODE_BLOCK_LANGUAGES
    : [language, ...CODE_BLOCK_LANGUAGES].filter((item, index, all) => {
        return Boolean(item) && all.indexOf(item) === index;
      });
  const languageClass = highlight ? `language-${highlight}` : undefined;

  return (
    <NodeViewWrapper
      className="md-code"
      data-filename={filename || undefined}
      data-language={language || undefined}
    >
      {editable ? (
        <div className="md-code-toolbar" contentEditable={false}>
          <Select
            aria-label="言語"
            className="w-auto rounded-md px-2 py-1 text-[0.8rem]"
            value={language}
            onChange={(event) => {
              updateAttributes({ language: event.target.value || null });
            }}
          >
            <option value="">プレーン</option>
            {languages
              .filter((item) => item)
              .map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
          </Select>
          <Input
            aria-label="ファイル名"
            className="min-w-0 flex-1 rounded-md px-2 py-1 text-[0.8rem]"
            placeholder="ファイル名（hoge.ts）"
            value={filename}
            onChange={(event) => {
              const next = event.target.value;
              const inferred = inferLanguageFromFilename(next);
              updateAttributes({
                filename: next,
                ...(language || !inferred ? {} : { language: inferred }),
              });
            }}
          />
        </div>
      ) : (
        filename && <div className="md-code-filename">{filename}</div>
      )}
      <pre>
        <NodeViewContent<"code"> as="code" className={languageClass} />
      </pre>
    </NodeViewWrapper>
  );
}

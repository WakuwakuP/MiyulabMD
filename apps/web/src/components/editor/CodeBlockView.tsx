import {
  type DiagramLanguage,
  diagramLanguage,
  highlightLanguage,
  inferLanguageFromFilename,
  normalizeFilename,
} from "@miyulabmd/markdown";
import type { Editor } from "@tiptap/core";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewContent, NodeViewWrapper } from "@tiptap/react";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { useTheme } from "../../hooks/use-theme.ts";
import { CODE_BLOCK_LANGUAGES } from "../../lib/code-highlight.ts";
import {
  type DiagramResult,
  insertDiagramSvg,
  renderDiagram,
  useDiagramDark,
} from "../../lib/diagrams.ts";
import { Input } from "../ui/Input.tsx";
import { Select } from "../ui/Select.tsx";

function diagramState(result: DiagramResult | null): string {
  if (!result) {
    return "loading";
  }
  return result.ok ? "done" : "error";
}

/** Track whether the caret or node selection sits inside this code block. */
function useBlockFocused(
  editor: Editor,
  getPos: () => number | undefined,
  selected: boolean,
  nodeSize: number,
  enabled: boolean,
): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setFocused(false);
      return;
    }
    const sync = () => {
      const pos = typeof getPos === "function" ? getPos() : null;
      if (typeof pos !== "number") {
        setFocused(false);
        return;
      }
      const { from, to } = editor.state.selection;
      setFocused(Boolean(selected) || (from > pos && to < pos + nodeSize));
    };
    editor.on("selectionUpdate", sync);
    editor.on("update", sync);
    sync();
    return () => {
      editor.off("selectionUpdate", sync);
      editor.off("update", sync);
    };
  }, [editor, getPos, selected, nodeSize, enabled]);
  return focused;
}

/** Render while unpaused; cached results keep focus toggles instant. */
function useDiagramResult(
  lang: DiagramLanguage | null,
  source: string,
  dark: boolean,
  paused: boolean,
): DiagramResult | null {
  const [result, setResult] = useState<DiagramResult | null>(null);
  useEffect(() => {
    if (!lang || paused) {
      return;
    }
    let cancelled = false;
    renderDiagram(lang, source, dark).then((next) => {
      if (!cancelled) {
        setResult(next);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [lang, source, dark, paused]);
  return result;
}

function DiagramFigure({ svg }: { svg: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) {
      insertDiagramSvg(ref.current, svg);
    }
  }, [svg]);
  return <div className="md-diagram-figure" ref={ref} />;
}

function DiagramPane({
  lang,
  result,
  onSelect,
}: {
  lang: DiagramLanguage;
  result: DiagramResult | null;
  onSelect: (event: MouseEvent) => void;
}) {
  return (
    <div
      className="md-diagram md-diagram-embed"
      contentEditable={false}
      data-diagram-lang={lang}
      data-diagram-state={diagramState(result)}
      onClick={onSelect}
    >
      {result?.ok && <DiagramFigure svg={result.svg} />}
      {result && !result.ok && (
        <div className="md-diagram-error">
          図の描画に失敗しました: {result.error}
        </div>
      )}
    </div>
  );
}

export function CodeBlockView({
  node,
  updateAttributes,
  editor,
  getPos,
  selected,
}: NodeViewProps) {
  const language = String(node.attrs.language ?? "");
  const filename = String(node.attrs.filename ?? "");
  const editable = editor.isEditable;
  const highlight = highlightLanguage({ filename, language });
  const languages = CODE_BLOCK_LANGUAGES.includes(language)
    ? CODE_BLOCK_LANGUAGES
    : [language, ...CODE_BLOCK_LANGUAGES].filter((item, index, all) => {
        return Boolean(item) && all.indexOf(item) === index;
      });
  const languageClass = highlight ? `language-${highlight}` : undefined;

  const diagram = diagramLanguage({ filename, language });
  const { theme } = useTheme();
  const dark = useDiagramDark(theme);
  // OG card pattern: unfocused shows the rendered diagram, focusing the
  // block reveals the source text.
  const focused = useBlockFocused(
    editor,
    getPos,
    Boolean(selected),
    node.nodeSize,
    Boolean(diagram && editable),
  );
  const result = useDiagramResult(diagram, node.textContent, dark, focused);
  const showFigure = Boolean(diagram) && !focused;
  // On error keep the code visible so it can be fixed; hide it only while
  // loading or after a successful render.
  const hideCode = showFigure && !(result && !result.ok);

  function focusSource(event: MouseEvent) {
    if (!editable) {
      return;
    }
    event.preventDefault();
    const pos = getPos();
    if (typeof pos !== "number") {
      return;
    }
    editor
      .chain()
      .focus()
      .setTextSelection(pos + 1)
      .run();
  }

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
            onChange={(event) => {
              updateAttributes({ language: event.target.value || null });
            }}
            value={language}
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
            onChange={(event) => {
              const next = normalizeFilename(event.target.value);
              const inferred = inferLanguageFromFilename(next);
              updateAttributes({
                filename: next,
                ...(language || !inferred ? {} : { language: inferred }),
              });
            }}
            placeholder="ファイル名（hoge.ts）"
            value={filename}
          />
        </div>
      ) : (
        filename && <div className="md-code-filename">{filename}</div>
      )}
      <pre style={hideCode ? { display: "none" } : undefined}>
        <NodeViewContent<"code"> as="code" className={languageClass} />
      </pre>
      {showFigure && (
        <DiagramPane
          lang={diagram as DiagramLanguage}
          onSelect={focusSource}
          result={result}
        />
      )}
    </NodeViewWrapper>
  );
}

import { Markdown } from "@tiptap/markdown";
import { EditorContent, ReactNodeViewRenderer, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CodeBlockView } from "../../../src/components/editor/CodeBlockView.tsx";
import { HighlightedCodeBlock } from "../../../src/components/editor/extensions/code-block.ts";
import { ThemeProvider } from "../../../src/hooks/use-theme.ts";

const markdown = [
  "intro paragraph",
  "",
  "```mermaid",
  "graph TD",
  "  A[Client] --> B[Server]",
  "```",
  "",
  "plain paragraph",
  "",
  "```typescript",
  "const answer = 42;",
  "```",
].join("\n");

function EditorProbe() {
  const editor = useEditor({
    content: markdown,
    contentType: "markdown",
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      HighlightedCodeBlock.extend({
        addNodeView() {
          return ReactNodeViewRenderer(CodeBlockView);
        },
      }),
      Markdown,
    ],
  });
  return <EditorContent editor={editor} />;
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider>
        <EditorProbe />
      </ThemeProvider>
    </StrictMode>,
  );
}

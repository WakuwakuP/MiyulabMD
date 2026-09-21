import { renderMarkdownHtml } from "@miyulabmd/markdown";
import { StrictMode, useRef } from "react";
import { createRoot } from "react-dom/client";
import {
  type DiagramResult,
  renderDiagram,
  useDiagrams,
} from "../../../src/lib/diagrams.ts";

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging required
  interface Window {
    renderDiagramForTest?: (
      lang: "mermaid" | "plantuml",
      source: string,
      dark: boolean,
    ) => Promise<DiagramResult>;
  }
}

const markdown = [
  "```mermaid",
  "graph TD",
  "  A[Client] --> B[Server]",
  "```",
  "",
  "```plantuml",
  "@startuml",
  "Alice -> Bob: hello",
  "@enduml",
  "```",
  "",
  "```mermaid",
  "graph TD",
  "  A[unclosed --> B{",
  "```",
].join("\n");

function App() {
  const articleRef = useRef<HTMLElement | null>(null);
  const html = renderMarkdownHtml(markdown);
  useDiagrams(articleRef, html, "light");
  return (
    <article dangerouslySetInnerHTML={{ __html: html }} ref={articleRef} />
  );
}

window.renderDiagramForTest = renderDiagram;

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

import {
  type DiagramLanguage,
  diagramLanguage,
  parseFenceInfo,
} from "./fence-info.ts";

export type DiagramBlock = {
  /** 1-based line number of the opening fence. */
  line: number;
  language: DiagramLanguage;
  source: string;
};

type OpenFence = {
  char: string;
  info: string;
  marker: string;
};

const FENCE = /^(`{3,}|~{3,})(.*)$/;

function parseFenceLine(line: string): OpenFence | null {
  const match = FENCE.exec(line.trimStart());
  const marker = match?.[1] ?? "";
  if (!marker) {
    return null;
  }
  return { char: marker.charAt(0), info: (match?.[2] ?? "").trim(), marker };
}

// CommonMark: a closing fence is the same char, at least as long as the
// opener, with no info string.
function isClosingFence(fence: OpenFence, line: string): boolean {
  const parsed = parseFenceLine(line);
  return (
    parsed !== null &&
    parsed.char === fence.char &&
    parsed.marker.length >= fence.marker.length &&
    !parsed.info
  );
}

/**
 * Extract mermaid/plantuml fenced blocks from markdown text. A plain line
 * scanner — intentionally independent of the remark pipeline so non-HTML
 * consumers (e.g. the MCP diagram-check worker) can reuse it.
 */
export function extractDiagramBlocks(markdown: string): DiagramBlock[] {
  const blocks: DiagramBlock[] = [];
  const lines = markdown.split("\n");
  let fence: OpenFence | null = null;
  let block: DiagramBlock | null = null;
  let body: string[] = [];

  for (const [i, line] of lines.entries()) {
    if (!fence) {
      const parsed = parseFenceLine(line);
      if (parsed) {
        fence = parsed;
        const lang = diagramLanguage(parseFenceInfo(parsed.info));
        block = lang ? { language: lang, line: i + 1, source: "" } : null;
        body = [];
      }
      continue;
    }
    if (!isClosingFence(fence, line)) {
      body.push(line);
      continue;
    }
    if (block) {
      block.source = body.join("\n");
      blocks.push(block);
    }
    fence = null;
    block = null;
    body = [];
  }
  return blocks;
}

import type { Node as PMNode } from "@tiptap/pm/model";
import { canonicalizeEditorMarkdown } from "./embeds.ts";

export type OffsetPoint = {
  pm: number;
  md: number;
};

export type OffsetMap = {
  points: OffsetPoint[];
  markdown: string;
};

export function markdownEquivalent(a: string, b: string): boolean {
  return stripTrailing(canonicalizeEditorMarkdown(a)) === stripTrailing(canonicalizeEditorMarkdown(b));
}

function stripTrailing(value: string): string {
  return value.replace(/\s+$/u, "");
}

export function mapThrough(
  points: OffsetPoint[],
  value: number,
  fromKey: keyof OffsetPoint,
  toKey: keyof OffsetPoint,
): number {
  if (points.length === 0) return 0;
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return 0;
  if (value < first[fromKey]) return first[toKey];
  if (value > last[fromKey]) return last[toKey];

  for (let i = 0; i < points.length - 1; i += 1) {
    const start = points[i];
    const end = points[i + 1];
    if (!start || !end) continue;
    if (value < start[fromKey] || value > end[fromKey]) continue;
    if (value === end[fromKey]) return end[toKey];
    if (value === start[fromKey]) {
      const fromSpan = end[fromKey] - start[fromKey];
      const toSpan = end[toKey] - start[toKey];
      if (fromKey === "md" && fromSpan !== toSpan) return end[toKey];
      return start[toKey];
    }

    const fromSpan = end[fromKey] - start[fromKey];
    const toSpan = end[toKey] - start[toKey];
    if (fromSpan === toSpan && fromSpan > 0) {
      return start[toKey] + (value - start[fromKey]);
    }

    // Markdown 記法やブロック境界。リッチでは見えない文字は次の本文先頭へ寄せる。
    if (fromKey === "md") return end[toKey];
    return start[toKey];
  }

  return last[toKey];
}

export function pmToMd(map: OffsetMap, pm: number): number {
  return mapThrough(map.points, pm, "pm", "md");
}

export function mdToPm(map: OffsetMap, md: number): number {
  return mapThrough(map.points, md, "md", "pm");
}

export function clampPos(doc: PMNode, pos: number): number {
  return Math.max(0, Math.min(pos, doc.content.size));
}

export function alignTextSegments(
  markdown: string,
  segments: Array<{ text: string; pm: number; size: number }>,
): OffsetPoint[] {
  return buildPointsFromWalk(markdown, (emit, advance) => {
    let mdCursor = 0;
    for (const segment of segments) {
      if (!segment.text) continue;
      const idx = markdown.indexOf(segment.text, mdCursor);
      if (idx === -1) continue;
      emit(segment.pm, idx);
      emit(segment.pm + segment.size, idx + segment.text.length);
      mdCursor = idx + segment.text.length;
      advance(mdCursor);
    }
  });
}

function atomNeedle(name: string, attrs: Record<string, unknown>): string | null {
  if (name === "image") return typeof attrs.src === "string" ? attrs.src : null;
  if (name === "youtube") return typeof attrs.src === "string" ? attrs.src : null;
  if (name === "ogCard") return typeof attrs.href === "string" ? attrs.href : null;
  return null;
}

function atomBounds(markdown: string, name: string, idx: number, needle: string): { start: number; end: number } {
  if (name === "image") {
    const start = markdown.lastIndexOf("![", idx);
    const end = markdown.indexOf(")", idx + needle.length);
    return {
      start: start >= 0 ? start : idx,
      end: end >= 0 ? end + 1 : idx + needle.length,
    };
  }
  const start = markdown.lastIndexOf(":::", idx);
  const closer = markdown.indexOf(":::", idx + needle.length);
  return {
    start: start >= 0 ? start : idx,
    end: closer >= 0 ? closer + 3 : idx + needle.length,
  };
}

function startsWith(markdown: string, index: number, prefix: string): boolean {
  return markdown.startsWith(prefix, index);
}

function skipNewlines(markdown: string, index: number): number {
  let next = index;
  while (next < markdown.length && markdown[next] === "\n") next += 1;
  return next;
}

function skipMarkWrappers(markdown: string, index: number): number {
  let next = index;
  while (next < markdown.length) {
    if (startsWith(markdown, next, "**") || startsWith(markdown, next, "__") || startsWith(markdown, next, "~~")) {
      next += 2;
      continue;
    }
    const ch = markdown[next];
    if (ch === "*" || ch === "_" || ch === "~" || ch === "`") {
      next += 1;
      continue;
    }
    if (ch === "[") {
      next += 1;
      continue;
    }
    if (ch === "]" && markdown[next + 1] === "(") {
      const close = markdown.indexOf(")", next + 2);
      next = close === -1 ? markdown.length : close + 1;
      continue;
    }
    break;
  }
  return next;
}

function consumeHeadingOpen(markdown: string, index: number): number {
  let next = index;
  let hashes = 0;
  while (markdown[next] === "#") {
    hashes += 1;
    next += 1;
  }
  if (hashes === 0) return index;
  if (markdown[next] === " ") next += 1;
  return next;
}

function consumeFenceOpen(markdown: string, index: number): number {
  if (!startsWith(markdown, index, "```") && !startsWith(markdown, index, "~~~")) return index;
  const newline = markdown.indexOf("\n", index);
  return newline === -1 ? markdown.length : newline + 1;
}

function consumeFenceClose(markdown: string, index: number): number {
  let next = index;
  if (markdown[next] === "\n") next += 1;
  if (startsWith(markdown, next, "```") || startsWith(markdown, next, "~~~")) {
    next += 3;
    const newline = markdown.indexOf("\n", next);
    return newline === -1 ? markdown.length : newline + 1;
  }
  return index;
}

function consumeListMarker(markdown: string, index: number): number {
  let next = index;
  while (markdown[next] === " " || markdown[next] === "\t") next += 1;
  if (markdown[next] === "-" || markdown[next] === "*" || markdown[next] === "+") {
    if (markdown[next + 1] === " ") return next + 2;
  }
  const digits = markdown.slice(next).match(/^\d+\. /);
  if (digits) return next + digits[0].length;
  return index;
}

function consumeBlockquotePrefix(markdown: string, index: number): number {
  let next = index;
  while (markdown[next] === ">") {
    next += 1;
    if (markdown[next] === " ") next += 1;
  }
  return next === index ? index : next;
}

export function buildOffsetMap(doc: PMNode, markdown: string): OffsetMap {
  const points: OffsetPoint[] = [{ pm: 0, md: 0 }];
  let md = 0;

  const emit = (pm: number, nextMd: number) => {
    const prev = points[points.length - 1];
    if (prev && prev.pm === pm && prev.md === nextMd) return;
    points.push({ pm, md: nextMd });
  };

  const walk = (node: PMNode, pos: number) => {
    if (node.isText && node.text) {
      md = skipMarkWrappers(markdown, md);
      const idx = markdown.indexOf(node.text, md);
      if (idx === -1) return;
      emit(pos, idx);
      md = skipMarkWrappers(markdown, idx + node.text.length);
      emit(pos + node.text.length, md);
      return;
    }

    if (node.type.name === "hardBreak") {
      if (startsWith(markdown, md, "  \n")) md += 3;
      else if (markdown[md] === "\n") md += 1;
      emit(pos, md);
      return;
    }

    const needle = atomNeedle(node.type.name, node.attrs as Record<string, unknown>);
    if (needle) {
      const idx = markdown.indexOf(needle, md);
      if (idx === -1) return;
      const bounds = atomBounds(markdown, node.type.name, idx, needle);
      emit(pos, bounds.start);
      emit(pos + node.nodeSize, bounds.end);
      md = skipNewlines(markdown, bounds.end);
      return;
    }

    if (node.type.name === "horizontalRule") {
      const rule = markdown.slice(md).match(/^ {0,3}([-*_])\1{2,}[ \t]*/);
      if (rule) md += rule[0].length;
      md = skipNewlines(markdown, md);
      emit(pos, md);
      return;
    }

    if (node.isTextblock) {
      if (node.type.name === "heading") md = consumeHeadingOpen(markdown, md);
      if (node.type.name === "codeBlock") md = consumeFenceOpen(markdown, md);
      md = consumeBlockquotePrefix(markdown, md);
      const contentStart = pos + 1;
      if (node.childCount === 0) {
        emit(contentStart, md);
      } else {
        node.forEach((child, offset) => {
          walk(child, contentStart + offset);
        });
      }
      if (node.type.name === "codeBlock") md = consumeFenceClose(markdown, md);
      md = skipNewlines(markdown, md);
      return;
    }

    if (node.type.name === "listItem") {
      md = consumeListMarker(markdown, md);
    }

    const inner = node.isLeaf ? pos : pos + (node.type.name === "doc" ? 0 : 1);
    node.forEach((child, offset) => {
      walk(child, node.type.name === "doc" ? offset : inner + offset);
    });
  };

  walk(doc, 0);
  emit(doc.content.size, markdown.length);
  return { points: dedupePoints(points), markdown };
}

function buildPointsFromWalk(
  markdown: string,
  walk: (emit: (pm: number, md: number) => void, advance: (md: number) => void) => void,
): OffsetPoint[] {
  const points: OffsetPoint[] = [{ pm: 0, md: 0 }];
  walk(
    (pm, md) => {
      const prev = points[points.length - 1];
      if (prev && prev.pm === pm && prev.md === md) return;
      points.push({ pm, md });
    },
    () => undefined,
  );
  points.push({ pm: points[points.length - 1]?.pm ?? 0, md: markdown.length });
  return dedupePoints(points);
}

function dedupePoints(points: OffsetPoint[]): OffsetPoint[] {
  const next: OffsetPoint[] = [];
  for (const point of points) {
    const prev = next[next.length - 1];
    if (prev && prev.pm === point.pm && prev.md === point.md) continue;
    next.push(point);
  }
  return next;
}

import diff from "fast-diff";
import type * as Y from "yjs";

const EQUAL = 0;
const INSERT = 1;
const DELETE = -1;

export type AgentCursor = {
  anchor: number;
  head: number;
};

export type EditPlan =
  | { ok: true; next: string; cursor: AgentCursor }
  | {
      ok: false;
      error: "not_found" | "ambiguous" | "invalid";
      message: string;
      matches?: number;
    };

export type InsertPosition =
  | { at: "start" | "end" }
  | { after: string }
  | { before: string };

export type MarkdownHeading = {
  level: number;
  text: string;
  line: number;
};

/** 一意コンテキストの置換。複数ヒットかつ replaceAll でないときは失敗する。 */
export function planReplace(
  current: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): EditPlan {
  if (oldString.length === 0) {
    return {
      ok: false,
      error: "invalid",
      message: "old_string must not be empty",
    };
  }

  const indexes = findMatches(current, oldString);
  if (indexes.length === 0) {
    return {
      ok: false,
      error: "not_found",
      message: "old_string was not found",
      matches: 0,
    };
  }
  if (indexes.length > 1 && !replaceAll) {
    return {
      ok: false,
      error: "ambiguous",
      message:
        "old_string matched more than once; pass replace_all or add context",
      matches: indexes.length,
    };
  }

  let next = current;
  let cursor: AgentCursor = { anchor: 0, head: 0 };
  const shift = newString.length - oldString.length;
  for (let i = 0; i < indexes.length; i += 1) {
    const index = indexes[i]! + i * shift;
    next =
      next.slice(0, index) + newString + next.slice(index + oldString.length);
    cursor = { anchor: index, head: index + newString.length };
  }
  return { ok: true, next, cursor };
}

/** after / before は一意であること。 */
export function planInsert(
  current: string,
  text: string,
  position: InsertPosition,
): EditPlan {
  if (text.length === 0) {
    return { ok: false, error: "invalid", message: "text must not be empty" };
  }

  if ("at" in position) {
    if (position.at === "start") {
      return {
        ok: true,
        next: text + current,
        cursor: { anchor: 0, head: text.length },
      };
    }
    return {
      ok: true,
      next: current + text,
      cursor: { anchor: current.length, head: current.length + text.length },
    };
  }

  const needle = "after" in position ? position.after : position.before;
  if (needle.length === 0) {
    return {
      ok: false,
      error: "invalid",
      message: "after / before must not be empty",
    };
  }

  const indexes = findMatches(current, needle);
  if (indexes.length === 0) {
    return {
      ok: false,
      error: "not_found",
      message: "after / before context was not found",
      matches: 0,
    };
  }
  if (indexes.length > 1) {
    return {
      ok: false,
      error: "ambiguous",
      message:
        "after / before context matched more than once; add more context",
      matches: indexes.length,
    };
  }

  const index = indexes[0]!;
  const insertAt = "after" in position ? index + needle.length : index;
  return {
    ok: true,
    next: current.slice(0, insertAt) + text + current.slice(insertAt),
    cursor: { anchor: insertAt, head: insertAt + text.length },
  };
}

export function applyTextDiff(
  yText: Y.Text,
  next: string,
  origin?: unknown,
): boolean {
  const current = yText.toString();
  if (current === next) return false;

  const changes = diff(current, next);
  yText.doc?.transact(() => {
    let index = 0;
    for (const [op, text] of changes) {
      if (op === EQUAL) {
        index += text.length;
      } else if (op === INSERT) {
        yText.insert(index, text);
        index += text.length;
      } else if (op === DELETE) {
        yText.delete(index, text.length);
      }
    }
  }, origin);

  return true;
}

export function excerptAround(
  text: string,
  start: number,
  end: number,
  radius = 80,
): string {
  const from = Math.max(0, Math.min(start, end) - radius);
  const to = Math.min(text.length, Math.max(start, end) + radius);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < text.length ? "…" : "";
  return `${prefix}${text.slice(from, to)}${suffix}`;
}

export function markdownOutline(markdown: string): MarkdownHeading[] {
  const headings: MarkdownHeading[] = [];
  const lines = markdown.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(#{1,6})\s+(.+)$/.exec(lines[i] ?? "");
    if (!match) continue;
    headings.push({
      level: match[1]!.length,
      text: match[2]!.trim(),
      line: i + 1,
    });
  }
  return headings;
}

export function numberMarkdownLines(markdown: string): string {
  const lines = markdown.split("\n");
  const width = String(Math.max(lines.length, 1)).length;
  return lines
    .map((line, i) => `${String(i + 1).padStart(width, " ")}|${line}`)
    .join("\n");
}

function findMatches(haystack: string, needle: string): number[] {
  const indexes: number[] = [];
  if (needle.length === 0) return indexes;
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    indexes.push(index);
    from = index + needle.length;
  }
  return indexes;
}

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
      error: "invalid",
      message: "old_string must not be empty",
      ok: false,
    };
  }

  const indexes = findMatches(current, oldString);
  if (indexes.length === 0) {
    return {
      error: "not_found",
      matches: 0,
      message: "old_string was not found",
      ok: false,
    };
  }
  if (indexes.length > 1 && !replaceAll) {
    return {
      error: "ambiguous",
      matches: indexes.length,
      message:
        "old_string matched more than once; pass replace_all or add context",
      ok: false,
    };
  }

  let next = current;
  let cursor: AgentCursor = { anchor: 0, head: 0 };
  const shift = newString.length - oldString.length;
  for (let i = 0; i < indexes.length; i += 1) {
    const found = indexes[i];
    if (found === undefined) {
      continue;
    }
    const index = found + i * shift;
    next =
      next.slice(0, index) + newString + next.slice(index + oldString.length);
    cursor = { anchor: index, head: index + newString.length };
  }
  return { cursor, next, ok: true };
}

/** after / before は一意であること。 */
export function planInsert(
  current: string,
  text: string,
  position: InsertPosition,
): EditPlan {
  if (text.length === 0) {
    return { error: "invalid", message: "text must not be empty", ok: false };
  }

  if ("at" in position) {
    if (position.at === "start") {
      return {
        cursor: { anchor: 0, head: text.length },
        next: text + current,
        ok: true,
      };
    }
    return {
      cursor: { anchor: current.length, head: current.length + text.length },
      next: current + text,
      ok: true,
    };
  }

  const needle = "after" in position ? position.after : position.before;
  if (needle.length === 0) {
    return {
      error: "invalid",
      message: "after / before must not be empty",
      ok: false,
    };
  }

  const indexes = findMatches(current, needle);
  if (indexes.length === 0) {
    return {
      error: "not_found",
      matches: 0,
      message: "after / before context was not found",
      ok: false,
    };
  }
  if (indexes.length > 1) {
    return {
      error: "ambiguous",
      matches: indexes.length,
      message:
        "after / before context matched more than once; add more context",
      ok: false,
    };
  }

  const index = indexes[0];
  if (index === undefined) {
    return {
      error: "not_found",
      matches: 0,
      message: "after / before context was not found",
      ok: false,
    };
  }
  const insertAt = "after" in position ? index + needle.length : index;
  return {
    cursor: { anchor: insertAt, head: insertAt + text.length },
    next: current.slice(0, insertAt) + text + current.slice(insertAt),
    ok: true,
  };
}

export function applyTextDiff(
  yText: Y.Text,
  next: string,
  origin?: unknown,
): boolean {
  const current = yText.toString();
  if (current === next) {
    return false;
  }

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
    if (!match) {
      continue;
    }
    const marks = match[1];
    const heading = match[2];
    if (!marks || heading === undefined) {
      continue;
    }
    headings.push({
      level: marks.length,
      line: i + 1,
      text: heading.trim(),
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

export type ConditionalMarkdownDecision =
  | { action: "noop" }
  | { action: "apply" }
  | { action: "conflict" };

/** Compare current markdown with expected/new values without side effects. */
export function evaluateConditionalMarkdownUpdate(
  current: string,
  expectedMarkdown: string | undefined,
  markdown: string,
): ConditionalMarkdownDecision {
  if (expectedMarkdown !== undefined) {
    if (current !== expectedMarkdown) {
      return current === markdown ? { action: "noop" } : { action: "conflict" };
    }
  }
  return current === markdown ? { action: "noop" } : { action: "apply" };
}

function findMatches(haystack: string, needle: string): number[] {
  const indexes: number[] = [];
  if (needle.length === 0) {
    return indexes;
  }
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) {
      break;
    }
    indexes.push(index);
    from = index + needle.length;
  }
  return indexes;
}

import diff from "fast-diff";
import type * as Y from "yjs";

const EQUAL = 0;
const INSERT = 1;
const DELETE = -1;

export type YTextDeltaItem = {
  retain?: number;
  insert?: string;
  delete?: number;
};

const STRUCTURAL = /[\n`*_#[\]()!<>]/;

export function applyTextDiff(yText: Y.Text, next: string, origin?: unknown): boolean {
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

export function inspectPlainTextDelta(
  delta: YTextDeltaItem[],
): { kind: "insert"; index: number; text: string } | { kind: "delete"; index: number; length: number } | null {
  let index = 0;
  let found:
    | { kind: "insert"; index: number; text: string }
    | { kind: "delete"; index: number; length: number }
    | null = null;

  for (const item of delta) {
    if (item.retain) {
      index += item.retain;
      continue;
    }
    if (typeof item.insert === "string") {
      if (found || STRUCTURAL.test(item.insert)) return null;
      found = { kind: "insert", index, text: item.insert };
      index += item.insert.length;
      continue;
    }
    if (item.delete) {
      if (found) return null;
      found = { kind: "delete", index, length: item.delete };
    }
  }

  return found;
}

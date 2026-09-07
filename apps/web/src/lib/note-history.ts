import type { NoteEditOp } from "@miyulabmd/shared";

const whenFormat = new Intl.DateTimeFormat("ja-JP", {
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export function formatHistoryWhen(epochMs: number): string {
  return whenFormat.format(new Date(epochMs));
}

export function formatHistoryOp(op: NoteEditOp): string {
  if (op === "insert") {
    return "挿入";
  }
  if (op === "delete") {
    return "削除";
  }
  if (op === "restore") {
    return "復元";
  }
  return "置換";
}

export function formatHistoryRange(start: number, end: number): string {
  if (start === end) {
    return `${start} 文字目`;
  }
  return `${start}–${end} 文字`;
}

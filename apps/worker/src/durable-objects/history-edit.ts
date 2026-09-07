import type {
  NoteEditOp,
  NoteHistoryActor,
  NoteHistoryActorKind,
} from "@miyulabmd/shared";

import { agentDisplayName } from "./agent-presence.ts";
import type { AgentCursor } from "./markdown-edit.ts";

export const HISTORY_IDLE_MS = 3000;

export const APPLY_EDIT_ORIGIN = { source: "applyEdit" } as const;
export const APPLY_MARKDOWN_ORIGIN = { source: "applyMarkdown" } as const;

export type HistoryHunk = {
  start: number;
  inserted: string;
  deleted: number;
};

export type PendingHistorySession = {
  actor: NoteHistoryActor;
  actorKey: string;
  startedAt: number;
  endedAt: number;
  startOffset: number;
  endOffset: number;
  op: NoteEditOp;
};

export type HistoryEventInsert = {
  actorKind: NoteHistoryActorKind;
  actorUserId: string | null;
  actorName: string;
  startedAt: number;
  endedAt: number;
  startOffset: number;
  endOffset: number;
  op: NoteEditOp;
  excerpt: string;
  createdAt: number;
};

export type YTextDeltaItem = {
  retain?: number;
  delete?: number;
  insert?: unknown;
};

export function shouldSkipHistoryOrigin(origin: unknown): boolean {
  if (origin === APPLY_EDIT_ORIGIN || origin === APPLY_MARKDOWN_ORIGIN) {
    return true;
  }
  if (origin === "applyEdit" || origin === "applyMarkdown") {
    return true;
  }
  return false;
}

export function historyActorKey(
  actor: NoteHistoryActor,
  sessionKey?: string,
): string {
  if (actor.kind === "user" && actor.userId) {
    return `user:${actor.userId}`;
  }
  if (actor.kind === "agent" && actor.userId) {
    return `agent:${actor.userId}`;
  }
  return `guest:${sessionKey ?? "anon"}`;
}

export function actorFromWsAttachment(attachment: {
  userId?: string;
  displayName?: string;
  email?: string;
}): NoteHistoryActor {
  if (attachment.userId) {
    return {
      kind: "user",
      name: attachment.displayName?.trim() || attachment.email || "ユーザー",
      userId: attachment.userId,
    };
  }
  return {
    kind: "guest",
    name: attachment.displayName?.trim() || "ゲスト",
    userId: null,
  };
}

export function actorFromAgent(agent: {
  userId: string;
  displayName?: string;
}): NoteHistoryActor {
  return {
    kind: "agent",
    name: agentDisplayName(agent.displayName),
    userId: agent.userId,
  };
}

export function hunkOp(hunk: HistoryHunk): NoteEditOp {
  if (hunk.inserted.length > 0 && hunk.deleted > 0) {
    return "replace";
  }
  if (hunk.deleted > 0) {
    return "delete";
  }
  return "insert";
}

export function summarizeTextDelta(
  delta: readonly YTextDeltaItem[],
): HistoryHunk | null {
  let index = 0;
  let start: number | null = null;
  let inserted = "";
  let deleted = 0;

  for (const item of delta) {
    if (item.retain) {
      index += item.retain;
    }
    if (item.delete) {
      if (start === null) {
        start = index;
      }
      deleted += item.delete;
    }
    if (typeof item.insert === "string") {
      if (start === null) {
        start = index;
      }
      inserted += item.insert;
      index += item.insert.length;
    }
  }

  if (start === null) {
    return null;
  }
  return { deleted, inserted, start };
}

export function sessionFromHunk(
  actor: NoteHistoryActor,
  hunk: HistoryHunk,
  now: number,
  sessionKey?: string,
): PendingHistorySession {
  return {
    actor,
    actorKey: historyActorKey(actor, sessionKey),
    endedAt: now,
    endOffset: hunk.start + hunk.inserted.length,
    op: hunkOp(hunk),
    startedAt: now,
    startOffset: hunk.start,
  };
}

export function isAdjacentHunk(
  session: PendingHistorySession,
  hunk: HistoryHunk,
): boolean {
  const start = session.startOffset;
  const end = session.endOffset;
  if (hunk.deleted === 0) {
    return hunk.start >= start && hunk.start <= end;
  }
  return hunk.start + hunk.deleted >= start && hunk.start <= end;
}

export function applyHunkToSession(
  session: PendingHistorySession,
  hunk: HistoryHunk,
  now: number,
): PendingHistorySession {
  const adjacent = isAdjacentHunk(session, hunk);
  let startOffset = session.startOffset;
  let endOffset = session.endOffset;

  if (
    hunk.deleted === 0 &&
    hunk.start >= session.startOffset &&
    hunk.start <= session.endOffset
  ) {
    endOffset = session.endOffset + hunk.inserted.length;
  } else if (
    hunk.inserted.length === 0 &&
    hunk.start >= session.startOffset &&
    hunk.start + hunk.deleted <= session.endOffset
  ) {
    endOffset = session.endOffset - hunk.deleted;
  } else {
    startOffset = Math.min(session.startOffset, hunk.start);
    endOffset = Math.max(session.endOffset, hunk.start + hunk.inserted.length);
  }

  const nextOp = hunkOp(hunk);
  return {
    ...session,
    endedAt: now,
    endOffset,
    op: adjacent && session.op === nextOp ? session.op : "replace",
    startOffset,
  };
}

export function applyEditOp(
  inputOp: "insert" | "replace" | "set" | "restore",
  newTextLength: number,
  deleted: boolean,
): NoteEditOp {
  if (inputOp === "insert") {
    return "insert";
  }
  if (inputOp === "restore") {
    return "restore";
  }
  if (inputOp === "replace" && newTextLength === 0 && deleted) {
    return "delete";
  }
  return "replace";
}

export function actorFromSessionUser(
  user: {
    id: string;
    displayName?: string | null;
    email?: string;
  } | null,
): NoteHistoryActor {
  if (!user) {
    return {
      kind: "guest",
      name: "ゲスト",
      userId: null,
    };
  }
  return {
    kind: "user",
    name: user.displayName?.trim() || user.email || "ユーザー",
    userId: user.id,
  };
}

export function sessionFromApplyEdit(
  actor: NoteHistoryActor,
  cursor: AgentCursor,
  op: NoteEditOp,
  now: number,
): PendingHistorySession {
  const startOffset = Math.min(cursor.anchor, cursor.head);
  const endOffset = Math.max(cursor.anchor, cursor.head);
  return {
    actor,
    actorKey: historyActorKey(actor),
    endedAt: now,
    endOffset,
    op,
    startedAt: now,
    startOffset,
  };
}

export function eventFromSession(
  session: PendingHistorySession,
  excerpt: string,
): HistoryEventInsert {
  return {
    actorKind: session.actor.kind,
    actorName: session.actor.name,
    actorUserId: session.actor.userId,
    createdAt: session.endedAt,
    endedAt: session.endedAt,
    endOffset: session.endOffset,
    excerpt,
    op: session.op,
    startedAt: session.startedAt,
    startOffset: session.startOffset,
  };
}

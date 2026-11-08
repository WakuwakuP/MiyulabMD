import type { SessionUser, UpdateNoteMetaInput } from "@miyulabmd/shared";

import { findUserById, toSessionUser } from "../db/users.ts";
import { createNoteService } from "../services/notes.ts";

/**
 * Minimum interval between D1 ACL reads for a live DocumentRoom session.
 * Small enough that a mid-session permission change takes effect quickly,
 * large enough that a typing session does not hit D1 per keystroke.
 */
const ACCESS_RECHECK_MS = 5_000;

export type SocketAccessFlags = {
  canEdit: boolean;
  canView: boolean;
};

export function socketActorKey(userId?: string): string {
  return userId ? `user:${userId}` : "guest";
}

export function userIdFromActorKey(actorKey: string): string | undefined {
  return actorKey.startsWith("user:")
    ? actorKey.slice("user:".length)
    : undefined;
}

/**
 * Same evaluation DocumentRoom used at WebSocket connect: `notes.get` plus
 * anonymous-view/edit flags, folder inheritance, grants, and drive roles.
 */
export async function loadSocketAccess(
  env: Env,
  noteId: string,
  userId?: string,
): Promise<SocketAccessFlags> {
  let user: SessionUser | undefined;
  if (userId) {
    const row = await findUserById(env, userId);
    if (!row) {
      return { canEdit: false, canView: false };
    }
    user = toSessionUser(row);
  }
  const result = await createNoteService(env).get(noteId, user);
  if (result.kind !== "ok") {
    return { canEdit: false, canView: false };
  }
  return {
    canEdit: result.note.access.flags.canEdit,
    canView: result.note.access.flags.canView,
  };
}

/** Fields whose change can drop an already-connected viewer or editor. */
export function noteAccessFieldsChanged(input: UpdateNoteMetaInput): boolean {
  return (
    input.folder !== undefined ||
    input.grants !== undefined ||
    input.inheritAccess !== undefined ||
    input.permission !== undefined ||
    input.readScope !== undefined ||
    input.writeScope !== undefined
  );
}

/**
 * Throttled re-check of note ACL for a DocumentRoom socket.
 *
 * `X-Can-Edit` / view rights are set at WebSocket connect time. Without a
 * re-check, making the note private or revoking a grant would leave the
 * existing hibernated connection readable and writable.
 *
 * Failed or superseded reads deny both viewing and editing. Previously
 * granted rights must not survive an ACL read failure or invalidation.
 * Failures are not cached, so a later successful read can recover access.
 */
export class AccessRecheck {
  private readonly readFlags: (actorKey: string) => Promise<SocketAccessFlags>;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly cached = new Map<
    string,
    { checkedAt: number; flags: SocketAccessFlags }
  >();
  private readonly inflight = new Map<string, Promise<SocketAccessFlags>>();
  private readonly refreshSeq = new Map<string, number>();

  constructor(
    readFlags: (actorKey: string) => Promise<SocketAccessFlags>,
    intervalMs: number = ACCESS_RECHECK_MS,
    now: () => number = Date.now,
  ) {
    this.readFlags = readFlags;
    this.intervalMs = intervalMs;
    this.now = now;
  }

  /**
   * Throttled check for hot paths (per-message WS frames and broadcasts).
   * Concurrent callers for the same actor share one D1 read.
   */
  flags(actorKey: string): Promise<SocketAccessFlags> {
    const now = this.now();
    const cached = this.cached.get(actorKey);
    if (cached && now - cached.checkedAt < this.intervalMs) {
      return Promise.resolve(cached.flags);
    }
    return this.sharedRefresh(actorKey);
  }

  /**
   * Unthrottled check after an ACL mutation (PATCH / MCP access tools).
   * Also refreshes the throttle cache.
   */
  flagsNow(actorKey: string): Promise<SocketAccessFlags> {
    return this.refresh(actorKey);
  }

  /** Drop cached verdicts so the next check hits D1. */
  invalidate(): void {
    this.cached.clear();
    this.inflight.clear();
    for (const [key, seq] of this.refreshSeq) {
      this.refreshSeq.set(key, seq + 1);
    }
  }

  private sharedRefresh(actorKey: string): Promise<SocketAccessFlags> {
    const existing = this.inflight.get(actorKey);
    if (existing) {
      return existing;
    }
    const task = this.refresh(actorKey).finally(() => {
      if (this.inflight.get(actorKey) === task) {
        this.inflight.delete(actorKey);
      }
    });
    this.inflight.set(actorKey, task);
    return task;
  }

  private async refresh(actorKey: string): Promise<SocketAccessFlags> {
    const seq = (this.refreshSeq.get(actorKey) ?? 0) + 1;
    this.refreshSeq.set(actorKey, seq);
    try {
      const flags = await this.readFlags(actorKey);
      if (seq === this.refreshSeq.get(actorKey)) {
        this.cached.set(actorKey, { checkedAt: this.now(), flags });
      }
      // An ACL mutation or newer read superseded this request. Never let
      // its caller apply an older allow verdict to an existing socket.
      return seq === this.refreshSeq.get(actorKey)
        ? flags
        : { canEdit: false, canView: false };
    } catch {
      if (seq === this.refreshSeq.get(actorKey)) {
        this.cached.delete(actorKey);
      }
      return { canEdit: false, canView: false };
    }
  }
}

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

const DENY_FLAGS: SocketAccessFlags = { canEdit: false, canView: false };

/**
 * Throttled re-check of note ACL for a DocumentRoom socket.
 *
 * `X-Can-Edit` / view rights are set at WebSocket connect time. Without a
 * re-check, making the note private or revoking a grant would leave the
 * existing hibernated connection readable and writable.
 *
 * A successful read is authoritative. A thrown read on the throttled path
 * is a D1 blip: keep the last verdict (or report no verdict) so a live
 * editor is not disconnected and unsynced edits are not dropped. `flagsNow()`
 * still fail-closes, so an ACL mutation does not keep stale grants when the
 * fresh read fails. Failures are not stored as denials, so the next
 * successful read recovers access.
 */
export class AccessRecheck {
  private readonly readFlags: (actorKey: string) => Promise<SocketAccessFlags>;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly cached = new Map<
    string,
    { checkedAt: number; flags: SocketAccessFlags }
  >();
  private readonly failedAt = new Map<string, number>();
  /** Actors whose last verdict was dropped and must not be reused. */
  private readonly dropped = new Set<string>();
  private readonly inflight = new Map<
    string,
    Promise<SocketAccessFlags | null>
  >();
  private readonly closedInflight = new Map<
    string,
    Promise<SocketAccessFlags>
  >();
  private readonly latest = new Map<
    string,
    Promise<SocketAccessFlags | null>
  >();
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
   *
   * `null` means this attempt could not read D1 and there is no verdict to
   * publish. Callers keep the socket's current attachment.
   */
  flags(actorKey: string): Promise<SocketAccessFlags | null> {
    const closed = this.closedInflight.get(actorKey);
    if (closed) {
      return closed;
    }
    const now = this.now();
    const cached = this.cached.get(actorKey);
    if (cached && now - cached.checkedAt < this.intervalMs) {
      return Promise.resolve(cached.flags);
    }
    const failed = this.failedAt.get(actorKey);
    if (failed !== undefined && now - failed < this.intervalMs) {
      return Promise.resolve(this.verdictAfterFailure(actorKey));
    }
    return this.sharedRefresh(actorKey);
  }

  /**
   * Unthrottled check after an ACL mutation (PATCH / MCP access tools).
   * Also refreshes the throttle cache. A failed read denies: the mutation
   * already invalidated the previous grant, and that grant must not survive
   * a D1 error.
   */
  flagsNow(actorKey: string): Promise<SocketAccessFlags> {
    const existing = this.closedInflight.get(actorKey);
    if (existing) {
      return existing;
    }
    const task = this.refresh(actorKey, true)
      .then((flags) => flags ?? DENY_FLAGS)
      .finally(() => {
        if (this.closedInflight.get(actorKey) === task) {
          this.closedInflight.delete(actorKey);
        }
      });
    this.closedInflight.set(actorKey, task);
    return task;
  }

  /** Drop cached verdicts so the next check hits D1. */
  invalidate(): void {
    for (const actorKey of this.cached.keys()) {
      this.dropped.add(actorKey);
    }
    for (const actorKey of this.refreshSeq.keys()) {
      this.dropped.add(actorKey);
    }
    this.cached.clear();
    this.failedAt.clear();
    this.inflight.clear();
    this.latest.clear();
    for (const [key, seq] of this.refreshSeq) {
      this.refreshSeq.set(key, seq + 1);
    }
  }

  private sharedRefresh(actorKey: string): Promise<SocketAccessFlags | null> {
    const existing = this.inflight.get(actorKey);
    if (existing) {
      return existing;
    }
    const task = this.refresh(actorKey, false).finally(() => {
      if (this.inflight.get(actorKey) === task) {
        this.inflight.delete(actorKey);
      }
    });
    this.inflight.set(actorKey, task);
    return task;
  }

  private refresh(
    actorKey: string,
    failClosed: boolean,
  ): Promise<SocketAccessFlags | null> {
    const seq = (this.refreshSeq.get(actorKey) ?? 0) + 1;
    this.refreshSeq.set(actorKey, seq);
    const task = this.readFresh(actorKey, seq, failClosed);
    this.latest.set(actorKey, task);
    return task;
  }

  private joinNewer(
    actorKey: string,
    failClosed: boolean,
  ): Promise<SocketAccessFlags | null> {
    // Join the newer verdict, never an old allow or a synthetic revoke.
    // Invalidation clears latest; if no replacement started, read again.
    return this.latest.get(actorKey) ?? this.refresh(actorKey, failClosed);
  }

  private async readFresh(
    actorKey: string,
    seq: number,
    failClosed: boolean,
  ): Promise<SocketAccessFlags | null> {
    try {
      const flags = await this.readFlags(actorKey);
      if (seq !== this.refreshSeq.get(actorKey)) {
        return this.joinNewer(actorKey, failClosed);
      }
      this.failedAt.delete(actorKey);
      this.dropped.delete(actorKey);
      this.cached.set(actorKey, { checkedAt: this.now(), flags });
      return flags;
    } catch {
      if (seq !== this.refreshSeq.get(actorKey)) {
        return this.joinNewer(actorKey, failClosed);
      }
      if (failClosed) {
        this.cached.delete(actorKey);
        this.failedAt.delete(actorKey);
        this.dropped.add(actorKey);
        return DENY_FLAGS;
      }
      // Keep the last successful verdict. A missing verdict stays unknown
      // so DocumentRoom does not close the socket, unless this actor's
      // verdict was invalidated and must not survive the failed read.
      // Retry after the interval instead of hitting D1 on every keystroke.
      this.failedAt.set(actorKey, this.now());
      return this.verdictAfterFailure(actorKey);
    }
  }

  private verdictAfterFailure(actorKey: string): SocketAccessFlags | null {
    return (
      this.cached.get(actorKey)?.flags ??
      (this.dropped.has(actorKey) ? DENY_FLAGS : null)
    );
  }
}

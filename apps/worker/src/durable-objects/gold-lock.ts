import { isGoldLockedAt } from "@miyulabmd/shared";

/**
 * Minimum interval between D1 reads for the live gold-lock re-check.
 * Small enough that a promote/expire takes effect mid-session quickly,
 * large enough that a typing session does not hit D1 per keystroke.
 */
export const GOLD_LOCK_RECHECK_MS = 5_000;

export type GoldLockRow = {
  layer: string | null;
  gold_unlocked_until: number | null;
};

/**
 * Throttled re-check of the gold edit lock for a DocumentRoom.
 *
 * `X-Can-Edit` is frozen at WebSocket connect time, so a note promoted to
 * gold (or whose `gold_unlocked_until` expired) would otherwise stay
 * writable for the life of the connection. The room re-reads
 * `layer`/`gold_unlocked_until` at most once per `intervalMs` and only on
 * write paths.
 *
 * Read failures fail open: the durable boundary in
 * `persistMarkdownSnapshot` still refuses writes to a locked gold note,
 * so a transient D1 error must not drop live edits.
 */
export class GoldLockRecheck {
  private readonly readRow: () => Promise<GoldLockRow | null>;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private cached: { locked: boolean; checkedAt: number } | null = null;
  private inflight: Promise<boolean> | null = null;

  constructor(
    readRow: () => Promise<GoldLockRow | null>,
    intervalMs: number = GOLD_LOCK_RECHECK_MS,
    now: () => number = Date.now,
  ) {
    this.readRow = readRow;
    this.intervalMs = intervalMs;
    this.now = now;
  }

  /**
   * Throttled check for hot paths (per-message WS writes). Returns the
   * cached verdict while it is fresher than `intervalMs`; concurrent
   * callers share one D1 read.
   */
  locked(): Promise<boolean> {
    const now = this.now();
    if (this.cached && now - this.cached.checkedAt < this.intervalMs) {
      return Promise.resolve(this.cached.locked);
    }
    if (!this.inflight) {
      this.inflight = this.refresh();
    }
    return this.inflight;
  }

  /**
   * Unthrottled check for RPC write paths (`applyEdit`/`restoreMarkdown`),
   * where a fresh D1 read closes the race between the REST/MCP gate and
   * the Durable Object mutation. Also refreshes the throttle cache.
   */
  lockedNow(): Promise<boolean> {
    return this.refresh();
  }

  private async refresh(): Promise<boolean> {
    try {
      const row = await this.readRow();
      const locked = isGoldLockedAt(
        row?.layer,
        row?.gold_unlocked_until,
        this.now(),
      );
      this.cached = { checkedAt: this.now(), locked };
      return locked;
    } catch {
      // Fail open — persistMarkdownSnapshot is the authoritative gate.
      return false;
    } finally {
      this.inflight = null;
    }
  }
}

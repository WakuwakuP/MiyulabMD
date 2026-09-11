/** Viewer scope for offline cache partitioning. Not the server note `ownerId`. */
export type AccountScope = `user:${string}` | "guest";

export const GUEST_SCOPE: AccountScope = "guest";

export function accountScopeFromUserId(userId: string): AccountScope {
  return `user:${userId}`;
}

/** Same as `accountScopeFromUserId` — maps a real owner id to viewer scope (#96/#97). */
export const accountScopeFromOwnerId = accountScopeFromUserId;

export type Epoch<Tag extends string> = number & { readonly __epoch: Tag };

/** Account / auth state generation. */
export type SessionEpoch = Epoch<"session">;

/** Note load / session creation generation. */
export type RequestGeneration = Epoch<"request">;

/** Draft edit / sync lease ownership generation. */
export type LockEpoch = Epoch<"lock">;

let sessionEpochSeq = 0;
let requestGenerationSeq = 0;
let lockEpochSeq = 0;

export function nextSessionEpoch(): SessionEpoch {
  sessionEpochSeq += 1;
  return sessionEpochSeq as SessionEpoch;
}

export function nextRequestGeneration(): RequestGeneration {
  requestGenerationSeq += 1;
  return requestGenerationSeq as RequestGeneration;
}

export function nextLockEpoch(): LockEpoch {
  lockEpochSeq += 1;
  return lockEpochSeq as LockEpoch;
}

/** Bridge contract for reading the live editor before persist. Implementation in a later slice. */
export type EditorDrain = {
  /** Latest committed Markdown from the visible editor, not IDB. */
  readDraft(): string;
  drainSync(): { pendingComposition: boolean };
  /** Wait for IME commit and pending remote applies. */
  awaitIdle(): Promise<void>;
};

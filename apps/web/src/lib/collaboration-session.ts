import type { Note, SessionUser } from "@miyulabmd/shared";
import type * as Y from "yjs";
import type { ApiResult } from "./api.ts";
import { fetchNote } from "./api.ts";
import {
  applyAwarenessUser,
  type CollabAwareness,
  createYjsSession,
} from "./collaboration.ts";
import {
  deleteNotePersistence,
  type NotePersistence,
  openNotePersistence,
} from "./collaboration-persistence.ts";
import { getEditorDrain } from "./editor-drain.ts";
import { getSessionSnapshot, verifySession } from "./offline-session.ts";
import {
  type AccountScope,
  GUEST_SCOPE,
  type RequestGeneration,
  type SessionEpoch,
} from "./offline-types.ts";
import { subscribeOnlineStatus } from "./online-status.ts";
import {
  createSessionLifecycle,
  type SessionLifecycle,
} from "./page-lifecycle.ts";

export const DISCONNECT_BANNER =
  "接続が切れています。この端末で編集を続けています。";
export const LONG_DISCONNECT_BANNER =
  "接続が1分以上切れています。再接続を待っています。";
export const CHECKPOINT_FAILURE_BANNER =
  "端末への保存に失敗しました。編集内容はこの端末に保持されています。";

export type CollabSessionPhase =
  | "idle"
  | "initializing"
  | "connecting"
  | "syncing"
  | "synced"
  | "disconnected"
  | "suspended"
  | "closing"
  | "closed"
  | "auth-stopped"
  | "denied";

export type CollabSessionKey = {
  scope: AccountScope;
  noteId: string;
  sessionEpoch: SessionEpoch;
  generation: RequestGeneration;
};

export type CollabSessionSnapshot = {
  key: CollabSessionKey | null;
  needsSession: boolean;
  desiredConnection: boolean;
  phase: CollabSessionPhase;
  everSynced: boolean;
  disconnectedAt: number | null;
  longDisconnect: boolean;
  checkpointFailed: boolean;
  collabReady: boolean;
  editDenied: boolean;
  denied: boolean;
  authStopped: boolean;
};

export type CollabSessionDeps = {
  verifySession: typeof verifySession;
  fetchNote: (id: string) => Promise<ApiResult<Note>>;
  getSessionSnapshot: typeof getSessionSnapshot;
  openNotePersistence: typeof openNotePersistence;
  deleteNotePersistence: typeof deleteNotePersistence;
  createYjsSession: typeof createYjsSession;
  getEditorDrain: typeof getEditorDrain;
  subscribeOnlineStatus: typeof subscribeOnlineStatus;
  createSessionLifecycle: typeof createSessionLifecycle;
  now: () => number;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};

export type NoteCollabSession = {
  doc: Y.Doc;
  yMarkdown: Y.Text;
  awareness: CollabAwareness;
  getSnapshot: () => CollabSessionSnapshot;
  subscribe: (listener: (next: CollabSessionSnapshot) => void) => () => void;
  setNeedsSession: (needs: boolean) => void;
  setDesiredConnection: (desired: boolean) => void;
  retryNow: () => void;
  close: () => Promise<void>;
  setUser: (user: SessionUser | null) => void;
};

const defaultDeps: CollabSessionDeps = {
  clearTimeout,
  createSessionLifecycle,
  createYjsSession,
  deleteNotePersistence,
  fetchNote,
  getEditorDrain,
  getSessionSnapshot,
  now: () => Date.now(),
  openNotePersistence,
  setTimeout,
  subscribeOnlineStatus,
  verifySession,
};

function isDeniedFetch(result: ApiResult<Note>): boolean {
  return (
    !result.ok &&
    result.kind === "http" &&
    (result.status === 403 || result.status === 404)
  );
}

function isAuthFetchFailure(result: ApiResult<Note>): boolean {
  return (
    !result.ok &&
    (result.kind === "invalid-response" ||
      (result.kind === "http" && result.status === 401))
  );
}

function isTransientFetchFailure(result: ApiResult<Note>): boolean {
  return (
    !result.ok &&
    result.kind !== "aborted" &&
    !isDeniedFetch(result) &&
    !isAuthFetchFailure(result)
  );
}

function retryDelayMs(attempt: number): number {
  const exponent = Math.min(attempt, 5);
  const base = Math.min(2 ** exponent * 1000, 30_000);
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}

export function collabBannerMessage(
  snapshot: CollabSessionSnapshot,
): string | null {
  if (snapshot.checkpointFailed) {
    return CHECKPOINT_FAILURE_BANNER;
  }
  if (snapshot.denied || snapshot.authStopped) {
    return null;
  }
  const showDisconnect =
    snapshot.disconnectedAt !== null &&
    snapshot.phase !== "synced" &&
    snapshot.phase !== "suspended" &&
    snapshot.phase !== "closed" &&
    snapshot.phase !== "closing" &&
    snapshot.phase !== "idle";
  if (!showDisconnect) {
    return null;
  }
  if (snapshot.longDisconnect) {
    return `${DISCONNECT_BANNER} ${LONG_DISCONNECT_BANNER}`;
  }
  return DISCONNECT_BANNER;
}

export function createNoteCollabSession(input: {
  noteId: string;
  user: SessionUser | null;
  generation: RequestGeneration;
  deps?: Partial<CollabSessionDeps>;
}): NoteCollabSession {
  const deps: CollabSessionDeps = { ...defaultDeps, ...input.deps };
  const listeners = new Set<(next: CollabSessionSnapshot) => void>();

  let needsSession = true;
  let desiredConnection = true;
  let phase: CollabSessionPhase = "initializing";
  let everSynced = false;
  let disconnectedAt: number | null = null;
  let longDisconnect = false;
  let checkpointFailed = false;
  let editDenied = false;
  let denied = false;
  let authStopped = false;

  let canonicalNoteId = input.noteId;
  let currentUser = input.user;
  let connectAttempt = 0;
  let connectInFlight = false;
  let connectGeneration = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let longDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closing = false;
  let closed = false;
  let closingViaClose = false;
  let persistenceReady = false;
  let unbindProvider: (() => void) | null = null;
  let lifecycle: SessionLifecycle | null = null;
  let unbindOnline: (() => void) | null = null;

  const yjs = deps.createYjsSession(canonicalNoteId, currentUser);
  let persistence: NotePersistence | null = null;

  const key: CollabSessionKey = {
    generation: input.generation,
    noteId: canonicalNoteId,
    scope: deps.getSessionSnapshot().scope ?? GUEST_SCOPE,
    sessionEpoch: deps.getSessionSnapshot().sessionEpoch,
  };

  function snapshot(): CollabSessionSnapshot {
    return {
      authStopped,
      checkpointFailed,
      collabReady: everSynced,
      denied,
      desiredConnection,
      disconnectedAt,
      editDenied,
      everSynced,
      key: closed ? null : { ...key, noteId: canonicalNoteId },
      longDisconnect,
      needsSession,
      phase,
    };
  }

  function emit(): void {
    const next = snapshot();
    for (const listener of listeners) {
      listener(next);
    }
  }

  function setPhase(next: CollabSessionPhase): void {
    phase = next;
    emit();
  }

  function clearRetryTimer(): void {
    if (retryTimer !== null) {
      deps.clearTimeout(retryTimer);
      retryTimer = null;
    }
  }

  function clearLongDisconnectTimer(): void {
    if (longDisconnectTimer !== null) {
      deps.clearTimeout(longDisconnectTimer);
      longDisconnectTimer = null;
    }
  }

  function clearDisconnectState(): void {
    disconnectedAt = null;
    longDisconnect = false;
    clearLongDisconnectTimer();
  }

  function markDisconnected(): void {
    if (disconnectedAt === null) {
      disconnectedAt = deps.now();
    }
    if (longDisconnectTimer === null) {
      longDisconnectTimer = deps.setTimeout(() => {
        longDisconnect = true;
        emit();
      }, 60_000);
    }
  }

  function scheduleRetry(resetAttempt = false): void {
    if (!(needsSession && desiredConnection) || closed || closing) {
      return;
    }
    if (phase === "suspended" || authStopped || denied || editDenied) {
      return;
    }
    clearRetryTimer();
    if (resetAttempt) {
      connectAttempt = 0;
    }
    const delay = retryDelayMs(connectAttempt);
    connectAttempt += 1;
    retryTimer = deps.setTimeout(() => {
      retryTimer = null;
      void runConnect();
    }, delay);
  }

  function leaveTransport(): void {
    yjs.provider.awareness.setLocalState(null);
    yjs.provider.disconnect();
  }

  function bindProviderEvents(): void {
    const provider = yjs.provider;

    const onSync = (synced: boolean) => {
      if (closed || closing) {
        return;
      }
      if (synced) {
        everSynced = true;
        clearDisconnectState();
        connectAttempt = 0;
        clearRetryTimer();
        setPhase("synced");
        return;
      }
      if (everSynced) {
        setPhase("syncing");
      }
    };

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: provider status state machine
    const onStatus = (event: { status: string }) => {
      if (closed || closing || !needsSession) {
        return;
      }
      if (event.status === "connected" || event.status === "connecting") {
        if (everSynced) {
          markDisconnected();
        }
        setPhase(event.status === "connected" ? "syncing" : "connecting");
        return;
      }
      if (event.status !== "disconnected") {
        return;
      }
      if (!desiredConnection || phase === "suspended") {
        return;
      }
      markDisconnected();
      setPhase(everSynced ? "disconnected" : "connecting");
      scheduleRetry();
    };

    provider.on("sync", onSync);
    provider.on("status", onStatus);

    unbindProvider = () => {
      provider.off("sync", onSync);
      provider.off("status", onStatus);
    };
  }

  function suspendInternal(): void {
    if (closed || closingViaClose || !needsSession) {
      return;
    }
    desiredConnection = false;
    clearRetryTimer();
    clearDisconnectState();
    setPhase("suspended");

    const drain = deps.getEditorDrain(canonicalNoteId);
    drain?.drainSync();
    void persistence?.checkpoint();

    leaveTransport();
  }

  function resumeInternal(): void {
    if (closed || closing || !needsSession || phase !== "suspended") {
      return;
    }
    desiredConnection = true;
    emit();
    scheduleRetry(true);
  }

  async function openPersistence(scope: AccountScope): Promise<boolean> {
    if (persistenceReady) {
      return true;
    }
    key.scope = scope;
    const opened = await deps.openNotePersistence({
      doc: yjs.doc,
      generation: key.generation,
      noteId: canonicalNoteId,
      scope,
    });
    if (!opened) {
      return false;
    }
    persistence = opened;
    await opened.whenSynced;
    persistenceReady = true;
    return true;
  }

  function staleAttempt(attemptGeneration: number): boolean {
    return attemptGeneration !== connectGeneration || closed || closing;
  }

  function stopForAuth(): void {
    authStopped = true;
    desiredConnection = false;
    clearRetryTimer();
    leaveTransport();
    setPhase("auth-stopped");
  }

  async function handleDeniedFetch(scope: AccountScope): Promise<void> {
    await deps.deleteNotePersistence(scope, [canonicalNoteId]);
    denied = true;
    needsSession = false;
    desiredConnection = false;
    clearRetryTimer();
    await closeInternal(false);
    setPhase("denied");
  }

  async function keepDocAndRetry(scope: AccountScope): Promise<void> {
    const opened = await openPersistence(scope);
    if (!opened) {
      return;
    }
    markDisconnected();
    setPhase(everSynced ? "disconnected" : "connecting");
    scheduleRetry();
  }

  async function connectWithNote(
    noteResult: Note,
    scope: AccountScope,
  ): Promise<void> {
    canonicalNoteId = noteResult.id;
    key.noteId = canonicalNoteId;

    if (!noteResult.access.flags.canEdit) {
      editDenied = true;
      desiredConnection = false;
      clearRetryTimer();
      leaveTransport();
      setPhase(everSynced ? "disconnected" : "synced");
      emit();
      return;
    }

    editDenied = false;
    const opened = await openPersistence(scope);
    if (!opened || closed) {
      return;
    }

    applyAwarenessUser(yjs.awareness, currentUser);
    setPhase("connecting");
    yjs.provider.connect();
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: connect / auth / retry state machine
  async function runConnect(): Promise<void> {
    if (connectInFlight || closed || closing) {
      return;
    }
    if (!(needsSession && desiredConnection)) {
      return;
    }
    if (phase === "suspended" || authStopped || denied) {
      return;
    }

    connectInFlight = true;
    connectGeneration += 1;
    const attemptGeneration = connectGeneration;

    try {
      setPhase(persistenceReady || everSynced ? "connecting" : "initializing");

      const sessionResult = await deps.verifySession();
      if (staleAttempt(attemptGeneration)) {
        return;
      }

      if (
        sessionResult.status === "unauthenticated" ||
        sessionResult.status === "verification-error"
      ) {
        stopForAuth();
        return;
      }

      const scope = sessionResult.scope ?? GUEST_SCOPE;
      key.scope = scope;
      key.sessionEpoch = sessionResult.sessionEpoch;

      const noteResult = await deps.fetchNote(canonicalNoteId);
      if (staleAttempt(attemptGeneration)) {
        return;
      }

      if (!noteResult.ok) {
        if (noteResult.kind === "aborted") {
          return;
        }
        if (isDeniedFetch(noteResult)) {
          await handleDeniedFetch(scope);
          return;
        }
        if (isAuthFetchFailure(noteResult)) {
          stopForAuth();
          return;
        }
        if (isTransientFetchFailure(noteResult)) {
          await keepDocAndRetry(scope);
        }
        return;
      }

      await connectWithNote(noteResult.data, scope);
    } finally {
      connectInFlight = false;
    }
  }

  async function drainEditor(): Promise<void> {
    const drain = deps.getEditorDrain(canonicalNoteId);
    if (!drain) {
      return;
    }
    await drain.awaitIdle();
    drain.drainSync();
  }

  async function checkpointBeforeClose(): Promise<boolean> {
    if (!persistence) {
      return true;
    }
    const ok = await persistence.checkpoint();
    if (ok) {
      return true;
    }
    checkpointFailed = true;
    closing = false;
    closingViaClose = false;
    setPhase(everSynced ? "disconnected" : "initializing");
    emit();
    return false;
  }

  async function destroyResources(): Promise<void> {
    leaveTransport();
    unbindProvider?.();
    unbindProvider = null;
    lifecycle?.destroy();
    lifecycle = null;
    unbindOnline?.();
    unbindOnline = null;

    if (persistence) {
      await persistence.destroy();
      persistence = null;
    }
    yjs.destroy();
  }

  async function closeInternal(checkpoint: boolean): Promise<boolean> {
    if (closed) {
      return true;
    }
    if (closing) {
      return false;
    }
    closing = true;
    closingViaClose = true;
    clearRetryTimer();
    clearLongDisconnectTimer();
    setPhase("closing");

    await drainEditor();
    if (checkpoint && !(await checkpointBeforeClose())) {
      return false;
    }

    await destroyResources();

    closed = true;
    closing = false;
    needsSession = false;
    desiredConnection = false;
    setPhase("closed");
    return true;
  }

  bindProviderEvents();
  lifecycle = deps.createSessionLifecycle({
    dispose: () => {
      /* closed via close() */
    },
    leave: suspendInternal,
    reconnect: resumeInternal,
  });
  unbindOnline = deps.subscribeOnlineStatus((online) => {
    if (online && needsSession && desiredConnection && phase !== "synced") {
      scheduleRetry(true);
    }
  });

  void (async () => {
    const scope = deps.getSessionSnapshot().scope ?? GUEST_SCOPE;
    const opened = await openPersistence(scope);
    if (!opened || closed) {
      setPhase("initializing");
      scheduleRetry();
      return;
    }
    if (needsSession && desiredConnection) {
      void runConnect();
    }
  })();

  emit();

  return {
    awareness: yjs.awareness,
    close: async () => {
      await closeInternal(true);
    },
    doc: yjs.doc,
    getSnapshot: snapshot,
    retryNow: () => {
      scheduleRetry(true);
    },
    setDesiredConnection(next) {
      desiredConnection = next;
      emit();
      if (next && needsSession && phase !== "suspended" && !closed) {
        scheduleRetry(true);
      }
      if (!next) {
        clearRetryTimer();
        leaveTransport();
      }
    },
    setNeedsSession(next) {
      const was = needsSession;
      needsSession = next;
      emit();
      if (!next && was) {
        void closeInternal(true);
        return;
      }
      if (next && desiredConnection && !closed) {
        scheduleRetry(true);
      }
    },
    setUser(next) {
      currentUser = next;
      yjs.setUser(next);
      applyAwarenessUser(yjs.awareness, next);
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },
    yMarkdown: yjs.yMarkdown,
  };
}

/** Test-only: compute retry delay for an attempt index. */
export function __testRetryDelayMs(attempt: number): number {
  return retryDelayMs(attempt);
}

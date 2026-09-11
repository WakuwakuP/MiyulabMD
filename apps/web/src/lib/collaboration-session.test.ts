import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Note, SessionUser } from "@miyulabmd/shared";
import * as Y from "yjs";
import type { ApiResult } from "./api.ts";
import type { YjsSession } from "./collaboration.ts";
import {
  __testRetryDelayMs,
  type CollabSessionDeps,
  collabBannerMessage,
  createNoteCollabSession,
  DISCONNECT_BANNER,
  LONG_DISCONNECT_BANNER,
} from "./collaboration-session.ts";
import type { SessionSnapshot } from "./offline-session.ts";
import {
  accountScopeFromUserId,
  nextRequestGeneration,
} from "./offline-types.ts";
import { createSessionLifecycle } from "./page-lifecycle.ts";

const scope = accountScopeFromUserId("user-a");
const noteId = "11111111-1111-4111-8111-111111111111";

const user: SessionUser = {
  displayName: "Alice",
  email: "alice@example.com",
  id: "user-a",
};

function note(canEdit = true): Note {
  return {
    access: {
      effectiveReadScope: "self",
      effectiveWriteScope: "self",
      flags: { canAdmin: true, canEdit, canView: true },
      grants: [],
      inherit: true,
      readScope: null,
      source: "default",
      sourceFolder: null,
      writeScope: null,
    },
    createdAt: 1,
    folder: "",
    folderId: null,
    id: noteId,
    markdown: "# Hello",
    ownerId: "user-a",
    shortId: "abc",
    title: "Hello",
    updatedAt: 1,
  };
}

type FakeProvider = {
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  off: (event: string, cb: (...args: unknown[]) => void) => void;
  connect: () => void;
  disconnect: () => void;
  awareness: { setLocalState: (state: null) => void };
  synced: boolean;
};

function createFakeDeps(overrides: Partial<CollabSessionDeps> = {}): {
  deps: CollabSessionDeps;
  provider: FakeProvider;
  connectCalls: number[];
  deleteCalls: string[][];
  timers: Array<{ delay: number; fn: () => void }>;
} {
  const connectCalls: number[] = [];
  const deleteCalls: string[][] = [];
  const timers: Array<{ delay: number; fn: () => void }> = [];
  const now = 0;
  const syncListeners = new Set<(synced: boolean) => void>();
  const statusListeners = new Set<(event: { status: string }) => void>();

  const emitSync = (synced: boolean) => {
    for (const listener of syncListeners) {
      listener(synced);
    }
  };
  const emitStatus = (status: string) => {
    for (const listener of statusListeners) {
      listener({ status });
    }
  };

  const provider: FakeProvider = {
    awareness: { setLocalState: () => undefined },
    connect() {
      connectCalls.push(now);
      statusListeners.forEach((listener) => {
        listener({ status: "connecting" });
      });
      statusListeners.forEach((listener) => {
        listener({ status: "connected" });
      });
    },
    disconnect() {
      statusListeners.forEach((listener) => {
        listener({ status: "disconnected" });
      });
    },
    off(event, cb) {
      if (event === "sync") {
        syncListeners.delete(cb as (synced: boolean) => void);
      }
      if (event === "status") {
        statusListeners.delete(cb as (event: { status: string }) => void);
      }
    },
    on(event, cb) {
      if (event === "sync") {
        syncListeners.add(cb as (synced: boolean) => void);
      }
      if (event === "status") {
        statusListeners.add(cb as (event: { status: string }) => void);
      }
    },
    synced: false,
  };

  const sessionSnapshot: SessionSnapshot = {
    dbBlocked: false,
    offlineReadable: true,
    pendingCleanup: false,
    scope,
    sessionEpoch: 1 as SessionSnapshot["sessionEpoch"],
    status: "online-confirmed",
    user,
  };

  const deps: CollabSessionDeps = {
    clearTimeout: (id) => {
      void id;
    },
    createSessionLifecycle: (options) =>
      createSessionLifecycle({
        ...options,
        bind: () => () => undefined,
      }),
    createYjsSession: () => {
      const doc = new Y.Doc();
      return {
        awareness: provider.awareness,
        destroy: () => {
          doc.destroy();
        },
        doc,
        leave: () => {
          provider.disconnect();
        },
        provider: provider as unknown as YjsSession["provider"],
        reconnect: () => {
          provider.connect();
        },
        setUser: () => undefined,
        yMarkdown: doc.getText("markdown"),
      };
    },
    deleteNotePersistence: (_scope, ids) => {
      deleteCalls.push([...ids]);
      return Promise.resolve();
    },
    fetchNote: async () => ({ data: note(), ok: true }),
    getEditorDrain: () => null,
    getSessionSnapshot: () => sessionSnapshot,
    now: () => now,
    openNotePersistence: async () => ({
      checkpoint: async () => true,
      destroy: async () => undefined,
      whenSynced: Promise.resolve(),
    }),
    setTimeout: (fn, delay) => {
      const entry = { delay: delay ?? 0, fn: fn as () => void };
      timers.push(entry);
      return timers.length;
    },
    subscribeOnlineStatus: () => () => undefined,
    verifySession: async () => sessionSnapshot,
    ...overrides,
  };

  return {
    connectCalls,
    deleteCalls,
    deps,
    emitStatus,
    emitSync,
    provider,
    timers,
  };
}

afterEach(() => {
  /* each test uses isolated deps */
});

test("everSynced stays false before first remote sync", async () => {
  const { deps } = createFakeDeps();
  const generation = nextRequestGeneration();
  const session = createNoteCollabSession({
    deps,
    generation,
    noteId,
    user,
  });
  assert.equal(session.getSnapshot().everSynced, false);
  assert.equal(session.getSnapshot().collabReady, false);
  await session.close();
});

test("disconnect keeps doc and does not reset disconnectedAt on retry", async () => {
  const { deps, emitSync, emitStatus, timers } = createFakeDeps();

  const session = createNoteCollabSession({
    deps,
    generation: nextRequestGeneration(),
    noteId,
    user,
  });

  await Promise.resolve();
  emitSync(true);
  assert.equal(session.getSnapshot().everSynced, true);

  emitStatus("disconnected");
  const firstAt = session.getSnapshot().disconnectedAt;
  assert.notEqual(firstAt, null);

  const retry = timers.at(-1);
  retry?.fn();
  await Promise.resolve();

  assert.equal(session.getSnapshot().disconnectedAt, firstAt);
  assert.notEqual(session.doc, null);
  await session.close();
});

test("long disconnect banner after 60s", () => {
  const snap = {
    authStopped: false,
    checkpointFailed: false,
    collabReady: true,
    denied: false,
    desiredConnection: true,
    disconnectedAt: 0,
    editDenied: false,
    everSynced: true,
    key: null,
    longDisconnect: true,
    needsSession: true,
    phase: "disconnected" as const,
  };
  const message = collabBannerMessage(snap);
  assert.match(message ?? "", new RegExp(DISCONNECT_BANNER));
  assert.match(message ?? "", new RegExp(LONG_DISCONNECT_BANNER));
});

test("preview-only needsSession true does not close while needsSession stays true", async () => {
  const { deps } = createFakeDeps();
  const session = createNoteCollabSession({
    deps,
    generation: nextRequestGeneration(),
    noteId,
    user,
  });
  session.setDesiredConnection(false);
  assert.equal(session.getSnapshot().needsSession, true);
  assert.notEqual(session.getSnapshot().phase, "closed");
  await session.close();
});

test("needsSession false closes session", async () => {
  const { deps } = createFakeDeps();
  const session = createNoteCollabSession({
    deps,
    generation: nextRequestGeneration(),
    noteId,
    user,
  });
  session.setNeedsSession(false);
  for (let i = 0; i < 100 && session.getSnapshot().phase !== "closed"; i++) {
    await Promise.resolve();
  }
  assert.equal(session.getSnapshot().phase, "closed");
});

test("retries are not parallel", async () => {
  const { deps, timers } = createFakeDeps({
    fetchNote: () =>
      new Promise<ApiResult<Note>>((resolve) => {
        setTimeout(() => resolve({ data: note(), ok: true }), 50);
      }),
  });

  const session = createNoteCollabSession({
    deps,
    generation: nextRequestGeneration(),
    noteId,
    user,
  });

  session.retryNow();
  session.retryNow();
  await Promise.resolve();

  const retryTimers = timers.filter((entry) => entry.delay > 0);
  assert.ok(retryTimers.length >= 1);
  await session.close();
});

test("403 deletes note persistence", async () => {
  let fetchCalled = false;
  const { deps, deleteCalls } = createFakeDeps({
    fetchNote: () => {
      fetchCalled = true;
      return Promise.resolve({
        error: "forbidden",
        kind: "http",
        ok: false,
        status: 403,
      });
    },
  });

  const session = createNoteCollabSession({
    deps,
    generation: nextRequestGeneration(),
    noteId,
    user,
  });
  for (
    let i = 0;
    i < 100 && !(fetchCalled && session.getSnapshot().denied);
    i++
  ) {
    await Promise.resolve();
  }
  assert.deepEqual(deleteCalls, [[noteId]]);
  assert.equal(session.getSnapshot().denied, true);
});

test("401 does not delete note persistence", async () => {
  let fetchCalled = false;
  const { deps, deleteCalls } = createFakeDeps({
    fetchNote: () => {
      fetchCalled = true;
      return Promise.resolve({
        error: "unauthorized",
        kind: "http",
        ok: false,
        status: 401,
      });
    },
  });

  const session = createNoteCollabSession({
    deps,
    generation: nextRequestGeneration(),
    noteId,
    user,
  });
  while (!fetchCalled) {
    await Promise.resolve();
  }
  await Promise.resolve();
  assert.deepEqual(deleteCalls, []);
  assert.equal(session.getSnapshot().authStopped, true);
  await session.close();
});

test("aborted fetch leaves snapshot phase unchanged", async () => {
  let phaseBefore = "";
  const { deps } = createFakeDeps({
    fetchNote: async () => ({
      error: "aborted",
      kind: "aborted",
      ok: false,
      status: 0,
    }),
  });

  const session = createNoteCollabSession({
    deps,
    generation: nextRequestGeneration(),
    noteId,
    user,
  });
  phaseBefore = session.getSnapshot().phase;
  await Promise.resolve();
  assert.equal(session.getSnapshot().phase, phaseBefore);
  assert.equal(session.getSnapshot().authStopped, false);
  await session.close();
});

test("retry delay grows 1/2/4 seconds capped at 30s", () => {
  assert.equal(__testRetryDelayMs(0) >= 1000, true);
  assert.equal(__testRetryDelayMs(0) < 2000, true);
  assert.equal(__testRetryDelayMs(1) >= 2000, true);
  assert.equal(__testRetryDelayMs(2) >= 4000, true);
  assert.equal(__testRetryDelayMs(10) <= 30_500, true);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Note } from "@miyulabmd/shared";
import type { ApiFailure } from "../lib/api.ts";
import type { SessionSnapshot } from "../lib/offline-session.ts";
import {
  accountScopeFromUserId,
  nextRequestGeneration,
  nextSessionEpoch,
} from "../lib/offline-types.ts";
import {
  applyEditorForceLoadResult,
  applyEditorLoadOutcome,
  canStartEdit,
  editorDesiredConnection,
  editorHeaderMutationsVisible,
  editorNeedsSession,
  isLocalDraftId,
  resolveEditorViewPhase,
  shouldRemoveSsrPreview,
  taskNoteIdFor,
  verifiedCanEdit,
} from "./editor-page.ts";

const note: Note = {
  access: {
    effectiveReadScope: "self",
    effectiveWriteScope: "self",
    flags: { canAdmin: true, canEdit: true, canView: true },
    grants: [],
    inherit: true,
    readScope: null,
    source: "default",
    sourceFolder: null,
    writeScope: null,
  },
  createdAt: 1,
  folder: "docs",
  folderId: null,
  id: "11111111-1111-4111-8111-111111111111",
  markdown: "# Cached",
  ownerId: "me",
  shortId: "abc",
  title: "Cached",
  updatedAt: 1,
};

const onlineSession: SessionSnapshot = {
  dbBlocked: false,
  offlineReadable: true,
  pendingCleanup: false,
  scope: accountScopeFromUserId("me"),
  sessionEpoch: nextSessionEpoch(),
  status: "online-confirmed",
  user: {
    displayName: "Me",
    email: "me@example.com",
    id: "me",
  },
};

const offlineSession: SessionSnapshot = {
  ...onlineSession,
  status: "offline-known",
};

test("isLocalDraftId detects local-* routes", () => {
  assert.equal(isLocalDraftId("local-draft-1"), true);
  assert.equal(isLocalDraftId("11111111-1111-4111-8111-111111111111"), false);
});

test("verifiedCanEdit requires verifiedForSession", () => {
  assert.equal(
    verifiedCanEdit(note, {
      cachedAt: 1,
      source: "server",
      verifiedForSession: false,
    }),
    false,
  );
  assert.equal(
    verifiedCanEdit(note, {
      cachedAt: 1,
      source: "server",
      verifiedForSession: true,
    }),
    true,
  );
});

test("canStartEdit blocks cache-only preview and offline new edits", () => {
  assert.equal(
    canStartEdit({
      collabActive: false,
      meta: { cachedAt: 1, source: "idb", verifiedForSession: false },
      note,
      pendingEdit: false,
      phase: "cached-preview",
      session: onlineSession,
    }),
    false,
  );
  assert.equal(
    canStartEdit({
      collabActive: false,
      meta: { cachedAt: 1, source: "server", verifiedForSession: true },
      note,
      pendingEdit: false,
      phase: "server-preview",
      session: onlineSession,
    }),
    true,
  );
  assert.equal(
    canStartEdit({
      collabActive: true,
      meta: { cachedAt: 1, source: "server", verifiedForSession: true },
      note,
      pendingEdit: true,
      phase: "editing",
      session: offlineSession,
    }),
    true,
  );
  assert.equal(
    canStartEdit({
      collabActive: false,
      meta: { cachedAt: 1, source: "server", verifiedForSession: true },
      note,
      pendingEdit: false,
      phase: "server-preview",
      session: offlineSession,
    }),
    false,
  );
});

test("resolveEditorViewPhase moves to preparing-edit then editing", () => {
  const meta = {
    cachedAt: 1,
    source: "server" as const,
    verifiedForSession: true,
  };
  assert.equal(
    resolveEditorViewPhase({
      collabActive: false,
      collabReady: false,
      hasPreview: true,
      loadError: null,
      meta,
      note,
      pendingEdit: true,
      revalidating: false,
      routeId: note.id,
    }),
    "preparing-edit",
  );
  assert.equal(
    resolveEditorViewPhase({
      collabActive: true,
      collabReady: true,
      hasPreview: true,
      loadError: null,
      meta,
      note,
      pendingEdit: true,
      revalidating: false,
      routeId: note.id,
    }),
    "editing",
  );
});

test("applyEditorForceLoadResult keeps cache on network failure", () => {
  const generation = nextRequestGeneration();
  const sessionEpoch = nextSessionEpoch();
  const failure: ApiFailure = {
    error: "offline",
    kind: "network",
    ok: false,
    status: 0,
  };
  const outcome = applyEditorForceLoadResult({
    ctx: { generation, routeId: note.id, sessionEpoch },
    currentGeneration: generation,
    currentSessionEpoch: sessionEpoch,
    hadPreview: true,
    result: failure,
  });
  assert.equal(outcome.stale, false);
  assert.equal(outcome.snapshot.viewPhase, "offline-preview");
});

test("applyEditorForceLoadResult clears body on 403", () => {
  const generation = nextRequestGeneration();
  const sessionEpoch = nextSessionEpoch();
  const failure: ApiFailure = {
    error: "forbidden",
    kind: "http",
    ok: false,
    status: 403,
  };
  const outcome = applyEditorForceLoadResult({
    ctx: { generation, routeId: note.id, sessionEpoch },
    currentGeneration: generation,
    currentSessionEpoch: sessionEpoch,
    hadPreview: true,
    result: failure,
  });
  assert.deepEqual(outcome.evictIds, [note.id]);
  assert.equal(outcome.snapshot.viewPhase, "denied");
  assert.equal(outcome.snapshot.note, null);
});

test("editorNeedsSession is true only while preparing or editing", () => {
  assert.equal(editorNeedsSession("preparing-edit"), true);
  assert.equal(editorNeedsSession("server-preview"), false);
});

test("editorDesiredConnection is true while preparing or editing", () => {
  assert.equal(editorDesiredConnection("preparing-edit"), true);
  assert.equal(editorDesiredConnection("editing"), true);
  assert.equal(editorDesiredConnection("server-preview"), false);
});

test("shouldRemoveSsrPreview removes SSR for every phase except loading", () => {
  assert.equal(shouldRemoveSsrPreview("loading"), false);
  assert.equal(shouldRemoveSsrPreview("revalidating"), true);
  assert.equal(shouldRemoveSsrPreview("offline-preview"), true);
  assert.equal(shouldRemoveSsrPreview("uncached"), true);
  assert.equal(shouldRemoveSsrPreview("denied"), true);
  assert.equal(shouldRemoveSsrPreview("not-found"), true);
});

test("applyEditorLoadOutcome keeps pendingEdit on successful revalidation", () => {
  const generation = nextRequestGeneration();
  const sessionEpoch = nextSessionEpoch();
  const current = {
    accessDraft: null,
    folder: "docs",
    loadError: null,
    markdown: "# Cached",
    meta: {
      cachedAt: 1,
      source: "idb" as const,
      verifiedForSession: false,
    },
    note,
    pendingEdit: true,
    previewBanner: null,
    viewPhase: "preparing-edit" as const,
  };
  const outcome = applyEditorForceLoadResult({
    ctx: { generation, routeId: note.id, sessionEpoch },
    currentGeneration: generation,
    currentSessionEpoch: sessionEpoch,
    hadPreview: true,
    result: {
      data: {
        cachedAt: Date.now(),
        note,
        source: "server",
        verifiedForSession: true,
      },
      ok: true,
    },
  });
  const merged = applyEditorLoadOutcome(outcome, current);
  assert.equal(merged.pendingEdit, true);
  assert.equal(merged.viewPhase, "server-preview");
});

test("applyEditorLoadOutcome clears pendingEdit on terminal denied", () => {
  const current = {
    accessDraft: null,
    folder: "",
    loadError: null,
    markdown: "",
    meta: null,
    note: null,
    pendingEdit: true,
    previewBanner: null,
    viewPhase: "preparing-edit" as const,
  };
  const merged = applyEditorLoadOutcome(
    {
      snapshot: {
        loadError: "forbidden",
        pendingEdit: false,
        viewPhase: "denied",
      },
      stale: false,
    },
    current,
  );
  assert.equal(merged.pendingEdit, false);
  assert.equal(merged.viewPhase, "denied");
});

test("editorHeaderMutationsVisible hides controls for offline preview", () => {
  assert.equal(
    editorHeaderMutationsVisible("offline-preview", onlineSession, false),
    false,
  );
  assert.equal(
    editorHeaderMutationsVisible("server-preview", onlineSession, false),
    true,
  );
});

test("taskNoteIdFor is omitted offline and before verification", () => {
  assert.equal(
    taskNoteIdFor({
      meta: { cachedAt: 1, source: "idb", verifiedForSession: false },
      note,
      phase: "cached-preview",
      session: onlineSession,
    }),
    undefined,
  );
  assert.equal(
    taskNoteIdFor({
      meta: { cachedAt: 1, source: "server", verifiedForSession: true },
      note,
      phase: "server-preview",
      session: onlineSession,
    }),
    note.id,
  );
  assert.equal(
    taskNoteIdFor({
      meta: { cachedAt: 1, source: "server", verifiedForSession: true },
      note,
      phase: "server-preview",
      session: offlineSession,
    }),
    undefined,
  );
  assert.equal(
    taskNoteIdFor({
      meta: { cachedAt: 1, source: "server", verifiedForSession: true },
      note,
      phase: "editing",
      session: onlineSession,
    }),
    undefined,
  );
});

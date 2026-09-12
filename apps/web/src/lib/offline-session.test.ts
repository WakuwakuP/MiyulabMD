import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import type { NoteSummary, SessionUser } from "@miyulabmd/shared";
import { indexedDB } from "fake-indexeddb";
import {
  invalidateNotesCache,
  peekNotes,
  upsertNoteSummary,
} from "./list-cache.ts";
import { peekNote } from "./note-cache.ts";
import {
  configureOfflineDb,
  resetOfflineDbForTests,
  writeSessionRecord,
} from "./offline-db.ts";
import {
  __testGetVerifyGeneration,
  __testSeedNoteCache,
  __testSetSessionState,
  beginLogout,
  getSessionSnapshot,
  hydrateSessionFromDb,
  registerPersistenceCleanup,
  resetOfflineSessionForTests,
  verifySession,
} from "./offline-session.ts";
import { accountScopeFromUserId, type SessionEpoch } from "./offline-types.ts";

const userA: SessionUser = {
  displayName: "Alice",
  email: "alice@example.com",
  id: "user-a",
};

const userB: SessionUser = {
  displayName: "Bob",
  email: "bob@example.com",
  id: "user-b",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function summary(id: string): NoteSummary {
  return {
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
    alias: null,
    articleMeta: {},
    createdAt: 1,
    folder: "",
    folderId: null,
    id,
    ownerId: "user-a",
    permission: "private",
    shortId: id,
    title: id,
    updatedAt: 1,
  };
}

afterEach(() => {
  invalidateNotesCache();
  resetOfflineSessionForTests();
  resetOfflineDbForTests();
  mock.restoreAll();
});

function mockFetchMe(response: Response | Promise<Response>): void {
  mock.method(globalThis, "fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/me")) {
      return Promise.resolve(response);
    }
    return Promise.reject(new Error(`unexpected fetch: ${url}`));
  });
}

test("verifySession 200 user becomes online-confirmed with user scope", async () => {
  configureOfflineDb({ indexedDB });
  mockFetchMe(jsonResponse({ user: userA }));
  const snap = await verifySession();
  assert.equal(snap.status, "online-confirmed");
  assert.equal(snap.scope, accountScopeFromUserId(userA.id));
  assert.deepEqual(snap.user, userA);
});

test("verifySession 200 guest does not wipe prior user scope data", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    lastConfirmedAt: Date.now(),
    lastConfirmedUser: {
      displayName: userA.displayName,
      email: userA.email,
      id: userA.id,
    },
    scope: accountScopeFromUserId(userA.id),
  });
  upsertNoteSummary(summary("keep-me"));
  mockFetchMe(jsonResponse({ user: null }));
  const snap = await verifySession();
  assert.equal(snap.status, "guest-confirmed");
  assert.equal(snap.scope, "guest");
  assert.equal(peekNotes()?.length, 1);
});

test("verifySession 401 becomes unauthenticated without wipe", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    scope: accountScopeFromUserId(userA.id),
    status: "online-confirmed",
    user: userA,
  });
  upsertNoteSummary(summary("keep-on-401"));
  mockFetchMe(jsonResponse({ error: "Unauthorized" }, 401));
  const snap = await verifySession();
  assert.equal(snap.status, "unauthenticated");
  assert.equal(snap.offlineReadable, false);
  assert.equal(peekNotes()?.length, 1);
});

test("verifySession invalid-response becomes verification-error without auto scope restore", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    lastConfirmedUser: {
      displayName: userA.displayName,
      email: userA.email,
      id: userA.id,
    },
    scope: accountScopeFromUserId(userA.id),
  });
  mockFetchMe(
    new Response("<!doctype html><html></html>", {
      headers: { "Content-Type": "text/html" },
      status: 200,
    }),
  );
  const snap = await verifySession();
  assert.equal(snap.status, "verification-error");
  assert.equal(snap.scope, null);
});

test("hydrateSessionFromDb adopts persisted epoch so next bump exceeds it", async () => {
  configureOfflineDb({ indexedDB });
  const persistedEpoch = 10 as SessionEpoch;
  await writeSessionRecord({
    confirmedAt: Date.now(),
    lastConfirmedUser: {
      displayName: userA.displayName,
      email: userA.email,
      id: userA.id,
    },
    offlineReadable: true,
    scope: null,
    sessionEpoch: persistedEpoch,
  });

  await hydrateSessionFromDb();
  assert.equal(getSessionSnapshot().sessionEpoch, persistedEpoch);

  const previousLocation = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { href: "" } },
  });
  await beginLogout();
  assert.ok(getSessionSnapshot().sessionEpoch > persistedEpoch);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: previousLocation,
  });
});

test("hydrateSessionFromDb different user bumps epoch above persisted value", async () => {
  configureOfflineDb({ indexedDB });
  const persistedEpoch = 10 as SessionEpoch;
  await writeSessionRecord({
    confirmedAt: Date.now(),
    lastConfirmedUser: {
      displayName: userA.displayName,
      email: userA.email,
      id: userA.id,
    },
    offlineReadable: true,
    scope: accountScopeFromUserId(userA.id),
    sessionEpoch: persistedEpoch,
  });

  await hydrateSessionFromDb();
  mockFetchMe(jsonResponse({ user: userB }));
  const snap = await verifySession();
  assert.ok(snap.sessionEpoch > persistedEpoch);
});

test("verifySession network with past scope becomes offline-known", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    lastConfirmedAt: Date.now(),
    lastConfirmedUser: {
      displayName: userA.displayName,
      email: userA.email,
      id: userA.id,
    },
    scope: accountScopeFromUserId(userA.id),
  });
  mock.method(globalThis, "fetch", () =>
    Promise.reject(new TypeError("Failed to fetch")),
  );
  const snap = await verifySession();
  assert.equal(snap.status, "offline-known");
  assert.equal(snap.scope, accountScopeFromUserId(userA.id));
  assert.equal(snap.offlineReadable, true);
  assert.equal(snap.user?.id, userA.id);
});

test("verifySession 401 then network stays unauthenticated without offline-known", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    lastConfirmedAt: Date.now(),
    lastConfirmedUser: {
      displayName: userA.displayName,
      email: userA.email,
      id: userA.id,
    },
    scope: accountScopeFromUserId(userA.id),
    status: "online-confirmed",
    user: userA,
  });

  let call = 0;
  mock.method(globalThis, "fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.endsWith("/api/me")) {
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }
    call += 1;
    if (call === 1) {
      return Promise.resolve(jsonResponse({ error: "Unauthorized" }, 401));
    }
    return Promise.reject(new TypeError("Failed to fetch"));
  });

  const after401 = await verifySession();
  assert.equal(after401.status, "unauthenticated");
  assert.equal(after401.offlineReadable, false);

  const afterNetwork = await verifySession();
  assert.equal(afterNetwork.status, "unauthenticated");
  assert.equal(afterNetwork.offlineReadable, false);
});

test("verifySession verification-error then network stays verification-error", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    lastConfirmedAt: Date.now(),
    lastConfirmedUser: {
      displayName: userA.displayName,
      email: userA.email,
      id: userA.id,
    },
    scope: accountScopeFromUserId(userA.id),
  });

  let call = 0;
  mock.method(globalThis, "fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.endsWith("/api/me")) {
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }
    call += 1;
    if (call === 1) {
      return Promise.resolve(
        new Response("<!doctype html><html></html>", {
          headers: { "Content-Type": "text/html" },
          status: 200,
        }),
      );
    }
    return Promise.reject(new TypeError("Failed to fetch"));
  });

  const afterInvalid = await verifySession();
  assert.equal(afterInvalid.status, "verification-error");
  assert.equal(afterInvalid.scope, null);

  const afterNetwork = await verifySession();
  assert.equal(afterNetwork.status, "verification-error");
  assert.equal(afterNetwork.scope, null);
  assert.equal(afterNetwork.offlineReadable, false);
});

test("verifySession different user bumps epoch and wipes memory cache", async () => {
  configureOfflineDb({ indexedDB });
  const scopeA = accountScopeFromUserId(userA.id);
  __testSetSessionState({
    scope: scopeA,
    sessionEpoch: 1,
    status: "online-confirmed",
    user: userA,
  });
  __testSeedNoteCache({
    access: summary("note-a").access,
    alias: null,
    articleMeta: {},
    createdAt: 1,
    folder: "",
    folderId: null,
    id: "note-a",
    markdown: "",
    ownerId: userA.id,
    permission: "private",
    shortId: "note-a",
    title: "note-a",
    updatedAt: 1,
  });
  upsertNoteSummary(summary("note-a"));

  const cleanedScopes: string[] = [];
  registerPersistenceCleanup({
    removeNotePersistence: () => undefined,
    removeScopePersistence: (scope) => {
      cleanedScopes.push(scope);
    },
  });

  mockFetchMe(jsonResponse({ user: userB }));
  const snap = await verifySession();
  assert.equal(snap.status, "online-confirmed");
  assert.equal(snap.scope, accountScopeFromUserId(userB.id));
  assert.ok(snap.sessionEpoch > 1);
  assert.equal(peekNote("note-a"), undefined);
  assert.equal(peekNotes(), null);
  assert.deepEqual(cleanedScopes, [scopeA]);
});

test("beginLogout bumps epoch, calls cleanup hook, sets pending cleanup when db blocked", async () => {
  configureOfflineDb({
    blockedTimeoutMs: 5,
    indexedDB: {
      open: () => {
        const request = {
          onblocked: null as (() => void) | null,
          set onerror(_handler: () => void) {
            /* never completes */
          },
          set onsuccess(_handler: () => void) {
            /* never completes */
          },
        } as unknown as IDBOpenDBRequest;
        queueMicrotask(() => request.onblocked?.());
        return request;
      },
    } as unknown as IDBFactory,
  });

  const scopeA = accountScopeFromUserId(userA.id);
  __testSetSessionState({
    scope: scopeA,
    sessionEpoch: 2,
    status: "online-confirmed",
    user: userA,
  });
  const cleaned: string[] = [];
  registerPersistenceCleanup({
    removeNotePersistence: () => undefined,
    removeScopePersistence: (scope) => {
      cleaned.push(scope);
    },
  });

  const previousLocation = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { href: "" } },
  });

  await beginLogout();
  assert.equal(globalThis.window.location.href, "/auth/logout");

  await new Promise((resolve) => setTimeout(resolve, 20));
  const snap = getSessionSnapshot();
  assert.ok(snap.sessionEpoch > 2);
  assert.equal(snap.status, "unauthenticated");
  assert.equal(snap.pendingCleanup, true);
  assert.deepEqual(cleaned, [scopeA]);

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: previousLocation,
  });
});

test("stale verifySession response does not rewind newer state", async () => {
  configureOfflineDb({ indexedDB });
  let resolveFirst: (value: Response) => void = () => undefined;
  const first = new Promise<Response>((resolve) => {
    resolveFirst = resolve;
  });
  let call = 0;
  mock.method(globalThis, "fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (!url.endsWith("/api/me")) {
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    }
    call += 1;
    if (call === 1) {
      return first;
    }
    return Promise.resolve(jsonResponse({ user: userB }));
  });

  const slow = verifySession();
  const fast = verifySession();
  resolveFirst(jsonResponse({ user: userA }));
  await slow;
  const snap = await fast;
  assert.equal(snap.user?.id, userB.id);
  assert.equal(__testGetVerifyGeneration(), 2);
});

test("verifySession aborted leaves state unchanged", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    scope: accountScopeFromUserId(userA.id),
    status: "unknown",
  });
  mock.method(globalThis, "fetch", () =>
    Promise.reject(new DOMException("Aborted", "AbortError")),
  );
  const before = getSessionSnapshot();
  const snap = await verifySession();
  assert.equal(snap.status, before.status);
  assert.equal(snap.scope, before.scope);
});

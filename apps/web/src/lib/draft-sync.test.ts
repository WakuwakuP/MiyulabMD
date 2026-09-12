import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import {
  type CreateNoteInput,
  computeCreateRequestHash,
} from "@miyulabmd/shared";
import { indexedDB } from "fake-indexeddb";
import { resetCreateNoteCoalescingForTests } from "../pages/home-page.ts";
import type { DraftJournalRecord } from "./draft-journal.ts";
import {
  commitCreateJournal,
  getJournal,
  listJournals,
  resetDraftJournalForTests,
} from "./draft-journal.ts";
import {
  adoptServerMarkdownWithoutCrdtMerge,
  mergeDraftMarkdownForPatch,
} from "./draft-markdown-merge.ts";
import {
  insertDraft,
  type LocalDraftId,
  listDrafts,
  resetDraftStoreForTests,
} from "./draft-store.ts";
import {
  __testDraftSyncRetryDelayMs,
  buildCreateInput,
  flushPendingDrafts,
  resetDraftSyncForTests,
} from "./draft-sync.ts";
import {
  configureOfflineDb,
  OFFLINE_DB_NAME,
  resetOfflineDbForTests,
} from "./offline-db.ts";
import {
  __testSetSessionState,
  resetOfflineSessionForTests,
} from "./offline-session.ts";
import { accountScopeFromUserId } from "./offline-types.ts";

const user = {
  displayName: "Me",
  email: "me@example.com",
  id: "me",
};

const localId = "local-11111111-1111-4111-8111-111111111111" as LocalDraftId;

function createInput(markdown = "# 無題\n") {
  return {
    clientDraftId: localId,
    draftOwnerId: user.id,
    inheritAccess: true as const,
    markdown,
  };
}

function noteResponse(id: string, markdown: string, status = 201) {
  return new Response(
    JSON.stringify({
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
      markdown,
      ownerId: user.id,
      permission: "private",
      shortId: id,
      title: "無題",
      updatedAt: 2,
    }),
    { headers: { "Content-Type": "application/json" }, status },
  );
}

afterEach(async () => {
  mock.restoreAll();
  resetDraftJournalForTests();
  resetDraftStoreForTests();
  resetOfflineDbForTests();
  resetOfflineSessionForTests();
  resetDraftSyncForTests();
  resetCreateNoteCoalescingForTests();
  await indexedDB.deleteDatabase(OFFLINE_DB_NAME);
});

test("journal precedes POST and duplicate flush coalesces to one create", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    offlineReadable: true,
    scope: accountScopeFromUserId(user.id),
    status: "online-confirmed",
    user,
  });

  let postCount = 0;
  mock.method(
    globalThis,
    "fetch",
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/notes") && init?.method === "POST") {
        postCount += 1;
        return Promise.resolve(noteResponse("server-1", "# 無題\n"));
      }
      if (url.includes("/api/notes/server-1") && init?.method === "GET") {
        return Promise.resolve(noteResponse("server-1", "# 無題\n", 200));
      }
      if (url.endsWith("/api/me")) {
        return Promise.resolve(
          new Response(JSON.stringify({ user }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    },
  );

  await commitCreateJournal({
    createInput: createInput(),
    localId,
    ownerId: user.id,
    revision: 1,
  });
  await insertDraft({
    createdAt: 1,
    folder: "",
    inheritAccess: true,
    kind: "draft",
    localId,
    markdown: "# 無題\n",
    ownerId: user.id,
    revision: 1,
    updatedAt: 1,
  });

  await Promise.all([flushPendingDrafts(), flushPendingDrafts()]);
  assert.equal(postCount, 1);
  assert.equal((await listDrafts(user.id)).length, 0);
});

test("same clientDraftId replay returns 200 without extra local drafts", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    offlineReadable: true,
    scope: accountScopeFromUserId(user.id),
    status: "online-confirmed",
    user,
  });

  let postCount = 0;
  mock.method(
    globalThis,
    "fetch",
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/notes") && init?.method === "POST") {
        postCount += 1;
        const status = postCount === 1 ? 201 : 200;
        return Promise.resolve(
          noteResponse("server-replay", "# 無題\n", status),
        );
      }
      if (url.endsWith("/api/me")) {
        return Promise.resolve(
          new Response(JSON.stringify({ user }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    },
  );

  const input = createInput();
  const { createNote } = await import("./api.ts");
  const first = await createNote(input);
  const second = await createNote(input);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!(first.ok && second.ok)) {
    return;
  }
  assert.equal(first.data.id, second.data.id);
  assert.equal(postCount, 2);
  assert.equal((await listDrafts(user.id)).length, 0);
});

test("network keeps the same clientDraftId without creating another draft row", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    offlineReadable: true,
    scope: accountScopeFromUserId(user.id),
    status: "online-confirmed",
    user,
  });

  mock.method(globalThis, "fetch", (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/notes")) {
      return Promise.reject(new TypeError("offline"));
    }
    if (url.endsWith("/api/me")) {
      return Promise.resolve(
        new Response(JSON.stringify({ user }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  });

  await commitCreateJournal({
    createInput: createInput(),
    localId,
    ownerId: user.id,
    revision: 1,
  });
  await insertDraft({
    createdAt: 1,
    folder: "",
    inheritAccess: true,
    kind: "draft",
    localId,
    markdown: "# 無題\n",
    ownerId: user.id,
    revision: 1,
    updatedAt: 1,
  });
  await flushPendingDrafts();
  const journals = await listJournals(user.id);
  assert.equal(journals.length, 1);
  assert.equal(journals[0]?.localId, localId);
  assert.equal(journals[0]?.sync.createRequest?.input.clientDraftId, localId);
});

test("HTTP 4xx does not add another draft journal", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    offlineReadable: true,
    scope: accountScopeFromUserId(user.id),
    status: "online-confirmed",
    user,
  });

  mock.method(
    globalThis,
    "fetch",
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/notes") && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({ code: "owner_mismatch", error: "bad" }),
            {
              headers: { "Content-Type": "application/json" },
              status: 409,
            },
          ),
        );
      }
      if (url.endsWith("/api/me")) {
        return Promise.resolve(
          new Response(JSON.stringify({ user }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    },
  );

  await commitCreateJournal({
    createInput: createInput(),
    localId,
    ownerId: user.id,
    revision: 1,
  });
  await flushPendingDrafts();
  assert.equal((await listJournals(user.id)).length, 1);
  const journal = await getJournal(user.id, localId);
  assert.equal(journal?.sync.phase, "blocked");
  assert.equal(journal?.sync.lastError?.code, "owner_mismatch");
});

test("410 blocks automatic retry loop", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    offlineReadable: true,
    scope: accountScopeFromUserId(user.id),
    status: "online-confirmed",
    user,
  });

  mock.method(
    globalThis,
    "fetch",
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/notes") && init?.method === "POST") {
        return Promise.resolve(
          new Response(
            JSON.stringify({ code: "draft_deleted", error: "gone" }),
            {
              headers: { "Content-Type": "application/json" },
              status: 410,
            },
          ),
        );
      }
      if (url.endsWith("/api/me")) {
        return Promise.resolve(
          new Response(JSON.stringify({ user }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    },
  );

  await commitCreateJournal({
    createInput: createInput(),
    localId,
    ownerId: user.id,
    revision: 1,
  });
  await flushPendingDrafts();
  assert.equal((await getJournal(user.id, localId))?.sync.phase, "blocked");
});

function sampleJournal(markdown: string): DraftJournalRecord {
  return {
    kind: "draft",
    localId,
    ownerId: user.id,
    sync: {
      acknowledgedLocalMarkdown: markdown,
      acknowledgedMarkdown: markdown,
      acknowledgedRevision: 1,
      createRequest: { input: createInput(markdown), revision: 1 },
      phase: "pending",
    },
  };
}

test("buildCreateInput keeps journal markdown when draft has newer body", () => {
  const input = buildCreateInput(sampleJournal("# 無題\n"));
  assert.equal(input?.markdown, "# 無題\n");
});

test("overlaying draft markdown changes create request hash", async () => {
  const fixed = createInput("# 無題\n");
  const overlaid: CreateNoteInput = { ...fixed, markdown: "# Hello\n" };
  assert.notEqual(
    await computeCreateRequestHash(fixed),
    await computeCreateRequestHash(overlaid),
  );
});

test("POST uses journal markdown then PATCH sends draft edits", async () => {
  configureOfflineDb({ indexedDB });
  __testSetSessionState({
    offlineReadable: true,
    scope: accountScopeFromUserId(user.id),
    status: "online-confirmed",
    user,
  });

  let postMarkdown: string | undefined;
  let patchMarkdown: string | undefined;
  let patchExpected: string | undefined;

  mock.method(
    globalThis,
    "fetch",
    (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/notes") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as CreateNoteInput;
        postMarkdown = body.markdown;
        return Promise.resolve(noteResponse("server-patch-1", "# 無題\n"));
      }
      if (
        url.includes("/api/notes/server-patch-1") &&
        init?.method === "PATCH"
      ) {
        const body = JSON.parse(String(init.body)) as {
          markdown?: string;
          expectedMarkdown?: string;
        };
        patchMarkdown = body.markdown;
        patchExpected = body.expectedMarkdown;
        return Promise.resolve(
          noteResponse("server-patch-1", "# Hello\n", 200),
        );
      }
      if (url.includes("/api/notes/server-patch-1")) {
        return Promise.resolve(
          noteResponse("server-patch-1", "# Hello\n", 200),
        );
      }
      if (url.endsWith("/api/me")) {
        return Promise.resolve(
          new Response(JSON.stringify({ user }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    },
  );

  await commitCreateJournal({
    createInput: createInput("# 無題\n"),
    localId,
    ownerId: user.id,
    revision: 1,
  });
  await insertDraft({
    createdAt: 1,
    folder: "",
    inheritAccess: true,
    kind: "draft",
    localId,
    markdown: "# Hello\n",
    ownerId: user.id,
    revision: 2,
    updatedAt: 2,
  });

  await flushPendingDrafts();

  assert.equal(postMarkdown, "# 無題\n");
  assert.equal(patchExpected, "# 無題\n");
  assert.equal(patchMarkdown, "# Hello\n");
});

test("adoptServerMarkdownWithoutCrdtMerge keeps server markdown only", () => {
  const local = "# local\nbody";
  const server = "# server\nbody";
  assert.equal(adoptServerMarkdownWithoutCrdtMerge(local, server), server);
});

test("mergeDraftMarkdownForPatch uses server body when local unchanged", () => {
  const baseline = "---\ntitle: a\n---\n\nbody";
  const merged = mergeDraftMarkdownForPatch({
    acknowledgedLocalMarkdown: baseline,
    acknowledgedMarkdown: "---\ntitle: b\n---\n\nbody",
    localMarkdown: baseline,
  });
  assert.equal(merged.conflict, false);
  assert.match(merged.markdown, /title: b/);
});

test("mergeDraftMarkdownForPatch applies local replacements onto server body", () => {
  const merged = mergeDraftMarkdownForPatch({
    acknowledgedLocalMarkdown: "hello world",
    acknowledgedMarkdown: "hello world",
    localMarkdown: "hello there",
  });
  assert.equal(merged.conflict, false);
  assert.equal(merged.markdown, "hello there");
});

test("retry delay grows with cap", () => {
  assert.ok(__testDraftSyncRetryDelayMs(0) >= 1000);
  assert.ok(__testDraftSyncRetryDelayMs(10) <= 60_000 + 12_000);
});

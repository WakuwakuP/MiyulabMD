import assert from "node:assert/strict";
import { test } from "node:test";
import type { NoteSummary } from "@miyulabmd/shared";
import type { LocalDraft } from "./draft-store.ts";
import {
  canCreateLocalDraft,
  mergeHomeDisplayNotes,
} from "./home-draft-list.ts";
import type { SessionSnapshot } from "./offline-session.ts";
import { accountScopeFromUserId, nextSessionEpoch } from "./offline-types.ts";

const user = {
  displayName: "Me",
  email: "me@example.com",
  id: "me",
};

function session(status: SessionSnapshot["status"]): SessionSnapshot {
  return {
    dbBlocked: false,
    offlineReadable: true,
    pendingCleanup: false,
    pendingCleanupScope: null,
    scope: accountScopeFromUserId(user.id),
    sessionEpoch: nextSessionEpoch(),
    status,
    user,
  };
}

function serverNote(id: string): NoteSummary {
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
    ownerId: user.id,
    permission: "private",
    shortId: id,
    title: id,
    updatedAt: 2,
  };
}

function localDraft(localId: string, updatedAt: number): LocalDraft {
  return {
    createdAt: updatedAt,
    folder: "",
    inheritAccess: true,
    kind: "draft",
    localId: localId as `local-${string}`,
    markdown: "# draft\n",
    ownerId: user.id,
    revision: 1,
    updatedAt,
  };
}

test("canCreateLocalDraft allows online-confirmed and offline-known only", () => {
  assert.equal(canCreateLocalDraft(session("online-confirmed"), user), true);
  assert.equal(canCreateLocalDraft(session("offline-known"), user), true);
  assert.equal(canCreateLocalDraft(session("unknown"), user), false);
  assert.equal(canCreateLocalDraft(session("guest-confirmed"), null), false);
});

test("mergeHomeDisplayNotes does not mutate server list input", () => {
  const server = [serverNote("server-1")];
  const merged = mergeHomeDisplayNotes(
    server,
    [localDraft("local-1", 3)],
    null,
  );
  assert.deepEqual(
    server.map((note) => note.id),
    ["server-1"],
  );
  assert.deepEqual(
    merged.map((note) => note.id),
    ["local-1", "server-1"],
  );
});

test("mergeHomeDisplayNotes hides promoted local drafts", () => {
  const server = [serverNote("server-1")];
  const merged = mergeHomeDisplayNotes(
    server,
    [localDraft("local-1", 3)],
    null,
    [
      {
        localId: "local-1" as const,
        ownerId: user.id,
        promotedAt: 1,
        serverId: "server-1",
      },
    ],
  );
  assert.deepEqual(
    merged.map((note) => note.id),
    ["server-1"],
  );
});

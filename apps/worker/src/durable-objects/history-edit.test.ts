import assert from "node:assert/strict";
import { test } from "node:test";

import {
  APPLY_EDIT_ORIGIN,
  actorFromAgent,
  actorFromSessionUser,
  actorFromWsAttachment,
  applyEditOp,
  applyHunkToSession,
  eventFromSession,
  historyActorKey,
  sessionFromApplyEdit,
  sessionFromHunk,
  shouldSkipHistoryOrigin,
  summarizeTextDelta,
} from "./history-edit.ts";
import { planReplace } from "./markdown-edit.ts";

const user = {
  kind: "user" as const,
  name: "Alice",
  userId: "u1",
};

test("summarizeTextDelta reads insert / delete / replace", () => {
  assert.deepEqual(summarizeTextDelta([{ insert: "hello" }]), {
    deleted: 0,
    inserted: "hello",
    start: 0,
  });
  assert.deepEqual(summarizeTextDelta([{ retain: 5 }, { delete: 3 }]), {
    deleted: 3,
    inserted: "",
    start: 5,
  });
  assert.deepEqual(
    summarizeTextDelta([{ retain: 2 }, { delete: 3 }, { insert: "hi" }]),
    { deleted: 3, inserted: "hi", start: 2 },
  );
  assert.equal(summarizeTextDelta([{ retain: 4 }]), null);
});

test("one typing session coalesces adjacent inserts into one event", () => {
  let session = sessionFromHunk(
    user,
    { deleted: 0, inserted: "h", start: 0 },
    1000,
  );
  session = applyHunkToSession(
    session,
    { deleted: 0, inserted: "e", start: 1 },
    1100,
  );
  session = applyHunkToSession(
    session,
    { deleted: 0, inserted: "y", start: 2 },
    1200,
  );

  assert.equal(session.op, "insert");
  assert.equal(session.startOffset, 0);
  assert.equal(session.endOffset, 3);
  assert.equal(session.startedAt, 1000);
  assert.equal(session.endedAt, 1200);

  const event = eventFromSession(session, "hey");
  assert.equal(event.op, "insert");
  assert.equal(event.startOffset, 0);
  assert.equal(event.endOffset, 3);
  assert.equal(event.actorUserId, "u1");
  assert.equal(event.createdAt, 1200);
});

test("backspace inside the session shrinks the range", () => {
  let session = sessionFromHunk(
    user,
    { deleted: 0, inserted: "hello", start: 0 },
    1000,
  );
  session = applyHunkToSession(
    session,
    { deleted: 1, inserted: "", start: 4 },
    1100,
  );
  assert.equal(session.op, "replace");
  assert.equal(session.startOffset, 0);
  assert.equal(session.endOffset, 4);
});

test("MCP replace range matches the applyEdit plan", () => {
  const current = "# Title\n\nhello world";
  const plan = planReplace(current, "hello", "こんにちは");
  assert.equal(plan.ok, true);
  if (!plan.ok) {
    return;
  }

  const op = applyEditOp("replace", "こんにちは".length, true);
  const session = sessionFromApplyEdit(
    actorFromAgent({ displayName: "Bob", userId: "u2" }),
    plan.cursor,
    op,
    2000,
  );
  assert.equal(session.op, "replace");
  assert.equal(session.startOffset, plan.cursor.anchor);
  assert.equal(session.endOffset, plan.cursor.head);
  assert.equal(session.actor.kind, "agent");
  assert.equal(session.startOffset, 9);
  assert.equal(session.endOffset, 14);
});

test("shouldSkipHistoryOrigin ignores applyEdit transactions", () => {
  assert.equal(shouldSkipHistoryOrigin(APPLY_EDIT_ORIGIN), true);
  assert.equal(shouldSkipHistoryOrigin("applyEdit"), true);
  assert.equal(shouldSkipHistoryOrigin({}), false);
});

test("applyEditOp restore is recorded as restore", () => {
  assert.equal(applyEditOp("restore", 10, true), "restore");
});

test("actorFromSessionUser prefers display name then email", () => {
  assert.deepEqual(
    actorFromSessionUser({
      displayName: "Alice",
      email: "a@example.com",
      id: "u1",
    }),
    { kind: "user", name: "Alice", userId: "u1" },
  );
  assert.deepEqual(actorFromSessionUser({ email: "a@example.com", id: "u1" }), {
    kind: "user",
    name: "a@example.com",
    userId: "u1",
  });
  assert.deepEqual(actorFromSessionUser(null), {
    kind: "guest",
    name: "ゲスト",
    userId: null,
  });
});

test("actorFromWsAttachment falls back to the signed-in email", () => {
  assert.deepEqual(
    actorFromWsAttachment({ email: "a@example.com", userId: "u1" }),
    { kind: "user", name: "a@example.com", userId: "u1" },
  );
});

test("guest and user actor keys stay distinct", () => {
  const guest = actorFromWsAttachment({ displayName: "Anon" });
  assert.equal(guest.kind, "guest");
  assert.equal(guest.userId, null);
  assert.equal(historyActorKey(guest, "sess-1"), "guest:sess-1");
  assert.equal(historyActorKey(user), "user:u1");
});

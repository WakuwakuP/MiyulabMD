import assert from "node:assert/strict";
import test from "node:test";

import {
  AccessRecheck,
  noteAccessFieldsChanged,
  type SocketAccessFlags,
  socketActorKey,
  userIdFromActorKey,
} from "./access-recheck.ts";

function harness(flags: SocketAccessFlags, intervalMs = 5_000) {
  const state = { flags, now: 1_000, reads: 0 };
  const access = new AccessRecheck(
    () => {
      state.reads += 1;
      return Promise.resolve(state.flags);
    },
    intervalMs,
    () => state.now,
  );
  return { access, state };
}

test("socketActorKey distinguishes guests from signed-in users", () => {
  assert.equal(socketActorKey(), "guest");
  assert.equal(socketActorKey("alice"), "user:alice");
  assert.equal(userIdFromActorKey("guest"), undefined);
  assert.equal(userIdFromActorKey("user:alice"), "alice");
});

test("noteAccessFieldsChanged ignores title-only patches", () => {
  assert.equal(noteAccessFieldsChanged({ title: "新しい題名" }), false);
  assert.equal(noteAccessFieldsChanged({ permission: "private" }), true);
  assert.equal(noteAccessFieldsChanged({ readScope: "self" }), true);
  assert.equal(noteAccessFieldsChanged({ writeScope: "self" }), true);
  assert.equal(noteAccessFieldsChanged({ inheritAccess: false }), true);
  assert.equal(noteAccessFieldsChanged({ grants: [] }), true);
  assert.equal(noteAccessFieldsChanged({ folder: "secret" }), true);
});

test("flags() throttles D1 reads within the interval", async () => {
  const { access, state } = harness({ canEdit: true, canView: true });
  assert.deepEqual(await access.flags("guest"), {
    canEdit: true,
    canView: true,
  });
  assert.deepEqual(await access.flags("guest"), {
    canEdit: true,
    canView: true,
  });
  assert.equal(state.reads, 1);
});

test("flags() picks up a mid-session ACL drop after the interval", async () => {
  const { access, state } = harness({ canEdit: true, canView: true });
  assert.equal((await access.flags("guest")).canEdit, true);

  state.flags = { canEdit: false, canView: false };
  state.now += 5_001;
  assert.deepEqual(await access.flags("guest"), {
    canEdit: false,
    canView: false,
  });
  assert.equal(state.reads, 2);
});

test("flagsNow() bypasses and refreshes the throttle cache", async () => {
  const { access, state } = harness({ canEdit: true, canView: true });
  assert.equal((await access.flags("guest")).canView, true);
  assert.equal(state.reads, 1);

  state.flags = { canEdit: false, canView: false };
  assert.deepEqual(await access.flagsNow("guest"), {
    canEdit: false,
    canView: false,
  });
  assert.equal(state.reads, 2);
  assert.deepEqual(await access.flags("guest"), {
    canEdit: false,
    canView: false,
  });
  assert.equal(state.reads, 2);
});

test("invalidate() forces the next throttled check to hit D1", async () => {
  const { access, state } = harness({ canEdit: true, canView: true });
  await access.flags("guest");
  state.flags = { canEdit: false, canView: false };
  access.invalidate();
  assert.deepEqual(await access.flags("guest"), {
    canEdit: false,
    canView: false,
  });
  assert.equal(state.reads, 2);
});

test("concurrent flags() calls for one actor share a single read", async () => {
  const { access, state } = harness({ canEdit: true, canView: true });
  const [a, b] = await Promise.all([
    access.flags("guest"),
    access.flags("guest"),
  ]);
  assert.equal(a.canEdit, true);
  assert.equal(b.canEdit, true);
  assert.equal(state.reads, 1);
});

test("actors do not share a cache slot", async () => {
  const state = {
    now: 1_000,
    reads: 0,
    rows: new Map<string, SocketAccessFlags>([
      ["guest", { canEdit: true, canView: true }],
      ["user:alice", { canEdit: false, canView: true }],
    ]),
  };
  const access = new AccessRecheck(
    (actorKey) => {
      state.reads += 1;
      return Promise.resolve(
        state.rows.get(actorKey) ?? { canEdit: false, canView: false },
      );
    },
    5_000,
    () => state.now,
  );
  assert.deepEqual(await access.flags("guest"), {
    canEdit: true,
    canView: true,
  });
  assert.deepEqual(await access.flags("user:alice"), {
    canEdit: false,
    canView: true,
  });
  assert.equal(state.reads, 2);
});

test("a slower in-flight read cannot overwrite a fresher flagsNow() verdict", async () => {
  const rows: SocketAccessFlags[] = [
    { canEdit: true, canView: true },
    { canEdit: false, canView: false },
  ];
  const releases: Array<() => void> = [];
  let calls = 0;
  const access = new AccessRecheck(
    () => {
      const flags = rows[calls++] ?? { canEdit: false, canView: false };
      return new Promise<SocketAccessFlags>((resolve) => {
        releases.push(() => resolve(flags));
      });
    },
    5_000,
    () => 1_000,
  );

  const slow = access.flags("guest");
  const fresh = access.flagsNow("guest");
  releases[1]?.();
  assert.deepEqual(await fresh, { canEdit: false, canView: false });
  releases[0]?.();
  assert.deepEqual(await slow, { canEdit: true, canView: true });
  assert.deepEqual(await access.flags("guest"), {
    canEdit: false,
    canView: false,
  });
  assert.equal(calls, 2);
});

test("read failure reuses the last known flags and is not cached as success", async () => {
  let fail = false;
  let reads = 0;
  const access = new AccessRecheck(() => {
    reads += 1;
    if (fail) {
      return Promise.reject(new Error("D1 unavailable"));
    }
    return Promise.resolve({ canEdit: true, canView: true });
  });
  assert.deepEqual(await access.flags("guest"), {
    canEdit: true,
    canView: true,
  });
  fail = true;
  assert.deepEqual(await access.flagsNow("guest"), {
    canEdit: true,
    canView: true,
  });
  fail = false;
  assert.deepEqual(await access.flagsNow("guest"), {
    canEdit: true,
    canView: true,
  });
  assert.equal(reads, 3);
});

test("read failure with no cache fails closed on writes and open on view", async () => {
  const access = new AccessRecheck(() =>
    Promise.reject(new Error("D1 unavailable")),
  );
  assert.deepEqual(await access.flags("guest"), {
    canEdit: false,
    canView: true,
  });
});

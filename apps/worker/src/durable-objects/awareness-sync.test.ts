import assert from "node:assert/strict";
import { test } from "node:test";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";
import {
  applyOwnedClientChanges,
  clientsForAwarenessBroadcast,
  encodeAwarenessNullUpdate,
  nextAwarenessClocks,
} from "./awareness-sync.ts";

test("clientsForAwarenessBroadcast includes removed ids", () => {
  assert.deepEqual(
    clientsForAwarenessBroadcast({
      added: [1],
      updated: [2],
      removed: [3],
    }),
    [1, 2, 3],
  );
});

test("applyOwnedClientChanges ignores relayed updated ids", () => {
  let owned = applyOwnedClientChanges([], { added: [123], removed: [] });
  owned = applyOwnedClientChanges(owned, { added: [], removed: [] });
  assert.deepEqual(owned, [123]);

  const relayed = { added: [] as number[], updated: [456], removed: [] };
  owned = applyOwnedClientChanges(owned, relayed);
  assert.deepEqual(owned, [123]);
  assert.equal(owned.includes(456), false);

  owned = applyOwnedClientChanges(owned, { added: [], removed: [123] });
  assert.deepEqual(owned, []);
});

test("nextAwarenessClocks stores clocks only for owned ids", () => {
  const clockOf = (id: number) => (id === 123 ? 4 : id === 456 ? 9 : undefined);
  const clocks = nextAwarenessClocks(
    {},
    [123],
    { added: [123], updated: [456], removed: [] },
    clockOf,
  );
  assert.deepEqual(clocks, { "123": 4 });
});

test("removal update clears only the removed client", () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const awA = new awarenessProtocol.Awareness(docA);
  const awB = new awarenessProtocol.Awareness(docB);
  try {
    awA.setLocalState({ userId: "a" });
    awB.setLocalState({ userId: "b" });
    awarenessProtocol.applyAwarenessUpdate(
      awB,
      awarenessProtocol.encodeAwarenessUpdate(awA, [docA.clientID]),
      "test",
    );
    awarenessProtocol.applyAwarenessUpdate(
      awA,
      awarenessProtocol.encodeAwarenessUpdate(awB, [docB.clientID]),
      "test",
    );

    assert.equal(awB.getStates().has(docA.clientID), true);
    assert.equal(awB.getStates().has(docB.clientID), true);

    awA.setLocalState(null);
    awarenessProtocol.applyAwarenessUpdate(
      awB,
      awarenessProtocol.encodeAwarenessUpdate(awA, [docA.clientID]),
      "test",
    );

    assert.equal(awB.getStates().has(docA.clientID), false);
    assert.equal(awB.getStates().has(docB.clientID), true);
  } finally {
    awA.destroy();
    awB.destroy();
    docA.destroy();
    docB.destroy();
  }
});

test("null update with stored clock removes a remote client", () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const awA = new awarenessProtocol.Awareness(docA);
  const awB = new awarenessProtocol.Awareness(docB);
  try {
    awA.setLocalState({ userId: "a" });
    awarenessProtocol.applyAwarenessUpdate(
      awB,
      awarenessProtocol.encodeAwarenessUpdate(awA, [docA.clientID]),
      "join",
    );
    const storedClock = awB.meta.get(docA.clientID)?.clock;
    assert.ok(storedClock !== undefined);

    awarenessProtocol.applyAwarenessUpdate(
      awB,
      encodeAwarenessNullUpdate([
        { clientId: docA.clientID, clock: storedClock },
      ]),
      "hibernate-close",
    );

    assert.equal(awB.getStates().has(docA.clientID), false);
    assert.equal(awB.getStates().has(docB.clientID), true);
  } finally {
    awA.destroy();
    awB.destroy();
    docA.destroy();
    docB.destroy();
  }
});

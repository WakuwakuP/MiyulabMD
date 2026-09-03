import assert from "node:assert/strict";
import { test } from "node:test";
import * as awarenessProtocol from "y-protocols/awareness";
import * as Y from "yjs";

import {
  AGENT_COLOR,
  agentAwarenessState,
  agentDisplayName,
  agentUserId,
} from "./agent-presence.ts";

test("agentUserId prefixes once", () => {
  assert.equal(agentUserId("u1"), "agent:u1");
  assert.equal(agentUserId("agent:u1"), "agent:u1");
});

test("agentDisplayName uses the token owner's name", () => {
  assert.equal(agentDisplayName("みゆ"), "AI(みゆ)");
  assert.equal(agentDisplayName(" user@example.com "), "AI(user@example.com)");
  assert.equal(agentDisplayName(null), "AI(ゲスト)");
  assert.equal(agentDisplayName(""), "AI(ゲスト)");
});

test("agentAwarenessState is readable by collab clients", () => {
  const doc = new Y.Doc();
  const yText = doc.getText("markdown");
  yText.insert(0, "hello world");
  const awareness = new awarenessProtocol.Awareness(doc);
  try {
    const state = agentAwarenessState(
      { userId: "user-1", displayName: "みゆ" },
      yText,
      {
        anchor: 6,
        head: 11,
      },
    );
    awareness.setLocalState(state);

    const stored = awareness.getLocalState() as typeof state;
    assert.equal(stored.kind, "agent");
    assert.equal(stored.displayName, "AI(みゆ)");
    assert.equal(stored.user.name, "AI(みゆ)");
    assert.equal(stored.color, AGENT_COLOR);
    assert.equal(stored.userId, "agent:user-1");

    const head = Y.createAbsolutePositionFromRelativePosition(
      Y.createRelativePositionFromJSON(stored.cursor.head),
      doc,
    );
    assert.equal(head?.index, 11);
  } finally {
    awareness.destroy();
    doc.destroy();
  }
});

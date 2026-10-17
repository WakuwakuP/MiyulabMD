import assert from "node:assert/strict";
import { test } from "node:test";

import { documentRoomWsHeaders } from "./note-websocket.ts";

const editableNote = {
  access: { flags: { canEdit: true } },
  editLocked: false,
  id: "note-1",
};

function spoofedUpgrade() {
  return new Request("https://md.example/ws/notes/note-1", {
    headers: {
      "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      "Sec-WebSocket-Version": "13",
      Upgrade: "websocket",
      "X-Can-Edit": "true",
      "X-Display-Name": "Victim",
      "X-Note-Id": "other-note",
      "X-User-Email": "victim@example.com",
      "X-User-Id": "victim-id",
    },
  });
}

test("guest WS drops client identity and ACL headers", () => {
  const headers = documentRoomWsHeaders(spoofedUpgrade(), editableNote, null);
  assert.equal(headers.get("Upgrade"), "websocket");
  assert.equal(headers.get("Sec-WebSocket-Key"), "dGhlIHNhbXBsZSBub25jZQ==");
  assert.equal(headers.get("X-Note-Id"), "note-1");
  assert.equal(headers.get("X-Can-Edit"), "true");
  assert.equal(headers.get("X-User-Id"), null);
  assert.equal(headers.get("X-User-Email"), null);
  assert.equal(headers.get("X-Display-Name"), null);
});

test("signed-in WS uses the session identity, not the client headers", () => {
  const headers = documentRoomWsHeaders(spoofedUpgrade(), editableNote, {
    displayName: "Alice",
    email: "alice@example.com",
    id: "alice-id",
  });
  assert.equal(headers.get("X-User-Id"), "alice-id");
  assert.equal(headers.get("X-User-Email"), "alice@example.com");
  assert.equal(headers.get("X-Display-Name"), "Alice");
});

test("signed-in WS without a display name does not keep a spoofed name", () => {
  const headers = documentRoomWsHeaders(spoofedUpgrade(), editableNote, {
    displayName: null,
    email: "alice@example.com",
    id: "alice-id",
  });
  assert.equal(headers.get("X-User-Id"), "alice-id");
  assert.equal(headers.get("X-Display-Name"), null);
});

test("X-Can-Edit follows ACL and edit lock, not the client header", () => {
  const locked = documentRoomWsHeaders(
    spoofedUpgrade(),
    { ...editableNote, editLocked: true },
    null,
  );
  assert.equal(locked.get("X-Can-Edit"), "false");

  const readOnly = documentRoomWsHeaders(
    spoofedUpgrade(),
    {
      access: { flags: { canEdit: false } },
      editLocked: false,
      id: "note-1",
    },
    null,
  );
  assert.equal(readOnly.get("X-Can-Edit"), "false");
});

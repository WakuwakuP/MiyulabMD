import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import { AccessRecheck } from "./access-recheck.ts";

// Node has no Workers runtime. Only replace its base class; exercise the
// real DocumentRoom message handler and ACL enforcement with a socket double.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export class DurableObject {}",
      };
    }
    return nextResolve(specifier, context);
  },
});
const { DocumentRoom } = await import("./DocumentRoom.ts");
hooks.deregister();

test("a write suspended on the edit-lock read cannot survive ACL revocation", async () => {
  const doc = new Y.Doc();
  const updateDoc = new Y.Doc();
  updateDoc.getText("markdown").insert(0, "must not persist");
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(updateDoc));
  let flags = { canEdit: true, canView: true };
  const access = new AccessRecheck(() => Promise.resolve(flags));
  let release!: (locked: boolean) => void;
  let entered!: () => void;
  const lockEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let attachment = { canEdit: true, canView: true, userId: "alice" };
  let closed = false;
  const socket = {
    close: () => {
      closed = true;
      socket.readyState = WebSocket.CLOSING;
    },
    deserializeAttachment: () => ({ ...attachment }),
    readyState: WebSocket.OPEN,
    send: () => {
      throw new Error("revoked socket must not receive data");
    },
    serializeAttachment: (value: typeof attachment) => {
      attachment = value;
    },
  };
  const room = Object.create(DocumentRoom.prototype) as InstanceType<
    typeof DocumentRoom
  >;
  Object.assign(room, {
    access,
    ctx: { getWebSockets: () => [socket] },
    editLock: {
      locked: () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
          entered();
        }),
    },
    ensureInitialized: () => Promise.resolve(),
    requireDoc: () => doc,
  });
  const pending = room.webSocketMessage(
    socket as unknown as WebSocket,
    encoding.toUint8Array(encoder).buffer as ArrayBuffer,
  );
  await lockEntered;
  flags = { canEdit: false, canView: false };
  await room.revokeStaleSockets();
  assert.equal(closed, true);
  release(false);
  await pending;
  assert.equal(doc.getText("markdown").toString(), "");
  doc.destroy();
  updateDoc.destroy();
});

test("a D1 blip during an edit does not revoke the socket", async () => {
  const doc = new Y.Doc();
  const updateDoc = new Y.Doc();
  updateDoc.getText("markdown").insert(0, "keep this");
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(updateDoc));
  const access = new AccessRecheck(() =>
    Promise.reject(new Error("D1 unavailable")),
  );
  let attachment = { canEdit: true, canView: true, userId: "alice" };
  let closed = false;
  const socket = {
    close: () => {
      closed = true;
      socket.readyState = WebSocket.CLOSING;
    },
    deserializeAttachment: () => ({ ...attachment }),
    readyState: WebSocket.OPEN,
    send: () => undefined,
    serializeAttachment: (value: typeof attachment) => {
      attachment = value;
    },
  };
  const room = Object.create(DocumentRoom.prototype) as InstanceType<
    typeof DocumentRoom
  >;
  Object.assign(room, {
    access,
    ctx: { getWebSockets: () => [socket] },
    editLock: { locked: () => Promise.resolve(false) },
    ensureInitialized: () => Promise.resolve(),
    requireDoc: () => doc,
  });
  await room.webSocketMessage(
    socket as unknown as WebSocket,
    encoding.toUint8Array(encoder).buffer as ArrayBuffer,
  );
  assert.equal(closed, false);
  assert.equal(attachment.canEdit, true);
  assert.equal(attachment.canView, true);
  assert.equal(doc.getText("markdown").toString(), "keep this");
  doc.destroy();
  updateDoc.destroy();
});

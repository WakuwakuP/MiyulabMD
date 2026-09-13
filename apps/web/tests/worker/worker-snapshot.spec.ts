import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";

// Use the same framing libraries as y-websocket without adding dependencies.
const require = createRequire(import.meta.resolve("y-websocket"));
const decoding = require("lib0/decoding");
const encoding = require("lib0/encoding");
const sync = require("y-protocols/sync");
const Y: typeof import("yjs") = require("yjs");

test("real Worker alarm projects a WebSocket Yjs edit to D1 after debounce", async ({
  page,
  context,
  baseURL,
}) => {
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === baseURL
      ? route.continue()
      : route.abort(),
  );
  await page.goto("/auth/login?email=worker-snapshot%40example.test");
  await page.waitForURL(`${baseURL}/`);
  const initial = "# Before alarm\n\nOriginal snapshot";
  const markdown = "# After alarm\n\nPersisted only through a Yjs update.";
  const created = await context.request.post("/api/notes", {
    data: { markdown: initial, permission: "private" },
  });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  const doc = new Y.Doc();
  try {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    sync.writeSyncStep1(encoder, doc);
    // Browser WebSocket carries the real HttpOnly login cookie. Keep this
    // socket open for the edit; no editor bundle or API mutation does the work.
    const frame = await page.evaluate(
      ({ id, request }) =>
        new Promise<number[]>((resolve, reject) => {
          const socket = new WebSocket(
            `${location.origin.replace("http", "ws")}/ws/notes/${id}`,
          );
          Object.assign(window, { snapshotSocket: socket });
          socket.binaryType = "arraybuffer";
          const timer = setTimeout(() => {
            socket.close();
            reject(new Error("Yjs initial sync timed out"));
          }, 10_000);
          socket.onopen = () => socket.send(new Uint8Array(request));
          socket.onerror = () => {
            clearTimeout(timer);
            reject(new Error("Authenticated snapshot WebSocket failed"));
          };
          socket.onmessage = (event) => {
            const bytes = new Uint8Array(event.data);
            // Standard y-websocket sync / sync-step-2, not awareness.
            if (bytes[0] === 0 && bytes[1] === 1) {
              clearTimeout(timer);
              resolve(Array.from(bytes));
            }
          };
        }),
      { id, request: Array.from(encoding.toUint8Array(encoder)) as number[] },
    );
    const decoder = decoding.createDecoder(new Uint8Array(frame));
    expect(decoding.readVarUint(decoder)).toBe(0);
    expect(
      sync.readSyncMessage(decoder, encoding.createEncoder(), doc, "server"),
    ).toBe(sync.messageYjsSyncStep2);
    expect(doc.getText("markdown").toString()).toBe(initial);
    const state = Y.encodeStateVector(doc);
    doc.transact(() => {
      const text = doc.getText("markdown");
      text.delete(0, text.length);
      text.insert(0, markdown);
    });
    const update = encoding.createEncoder();
    encoding.writeVarUint(update, 0);
    sync.writeUpdate(update, Y.encodeStateAsUpdate(doc, state));
    const sentAt = Date.now();
    await page.evaluate(
      (bytes) => {
        const socket = (window as Window & { snapshotSocket: WebSocket })
          .snapshotSocket;
        socket.send(new Uint8Array(bytes));
      },
      Array.from(encoding.toUint8Array(update)) as number[],
    );
    const immediate = await context.request.get(`/api/notes/${id}`);
    expect(immediate.status()).toBe(200);
    expect(await immediate.json()).toMatchObject({
      markdown: initial,
      title: "Before alarm",
    });
    await expect
      .poll(
        async () => {
          const response = await context.request.get(`/api/notes/${id}`);
          expect(response.status()).toBe(200);
          const note = await response.json();
          return { markdown: note.markdown, title: note.title };
        },
        { intervals: [100, 250, 500], timeout: 20_000 },
      )
      .toEqual({ markdown, title: "After alarm" });
    expect(Date.now() - sentAt).toBeGreaterThanOrEqual(3000);
  } finally {
    await page.evaluate(() => {
      (
        window as Window & { snapshotSocket?: WebSocket }
      ).snapshotSocket?.close();
    });
    doc.destroy();
  }
});

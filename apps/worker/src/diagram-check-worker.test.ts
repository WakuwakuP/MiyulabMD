import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// Node has no cloudflare:workers; only the base class needs a runtime stub.
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
const { default: worker, DiagramCheckRoom } = await import(
  "./diagram-check-worker.ts"
);
hooks.deregister();

test("the entry Worker forwards the unread body and unchanged response to a fresh DO", async () => {
  const ids: object[] = [];
  const response = new Response("unavailable", { status: 503 });
  const request = new Request("https://diagram-check.internal/", {
    body: "not json",
    method: "POST",
  });
  const env = {
    DIAGRAM_CHECK_ROOM: {
      get(id: object) {
        assert.equal(id, ids.at(-1));
        return {
          fetch(forwarded: Request) {
            assert.equal(forwarded, request);
            assert.equal(forwarded.bodyUsed, false);
            return Promise.resolve(response);
          },
        };
      },
      newUniqueId() {
        const id = {};
        ids.push(id);
        return id;
      },
    },
  };
  assert.equal(await worker.fetch(request, env), response);
  assert.equal(await worker.fetch(request, env), response);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
});

test("DO preserves method, JSON and blocks validation", async () => {
  const room = new DiagramCheckRoom();
  assert.equal(
    (await room.fetch(new Request("https://diagram-check.internal/"))).status,
    405,
  );
  for (const body of ["{", "null", "{}", '{"blocks":{}}']) {
    const response = await room.fetch(
      new Request("https://diagram-check.internal/", { body, method: "POST" }),
    );
    assert.equal(response.status, 400);
  }
});

test("DO checks diagrams and preserves fence lines while filtering invalid entries", async () => {
  const room = new DiagramCheckRoom();
  const response = await room.fetch(
    new Request("https://diagram-check.internal/", {
      body: JSON.stringify({
        blocks: [
          null,
          { language: "text", line: 1, source: "ignored" },
          { language: "mermaid", line: 3, source: "graph TD\nA --> B" },
          { language: "mermaid", line: 9, source: "graph TD\nA -->" },
        ],
      }),
      method: "POST",
    }),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.checked, 2);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 9);
});

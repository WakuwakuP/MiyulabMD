import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { apiRequest, deleteNote, fetchMe, fetchNotes } from "./api.ts";

afterEach(() => {
  mock.restoreAll();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

test("fetch throw becomes network with status 0", async () => {
  mock.method(globalThis, "fetch", () =>
    Promise.reject(new TypeError("Failed to fetch")),
  );
  const result = await apiRequest(
    "/api/test",
    {},
    {
      kind: "json",
      parse: (body) => body,
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.kind, "network");
  assert.equal(result.status, 0);
});

test("AbortError becomes aborted, not network", async () => {
  const error = new DOMException("Aborted", "AbortError");
  mock.method(globalThis, "fetch", () => Promise.reject(error));
  const result = await apiRequest(
    "/api/test",
    {},
    {
      kind: "json",
      parse: (body) => body,
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.kind, "aborted");
  assert.equal(result.status, 0);
});

test("401 JSON becomes http 401", async () => {
  mock.method(globalThis, "fetch", () =>
    Promise.resolve(jsonResponse({ error: "Unauthorized" }, 401)),
  );
  const result = await apiRequest(
    "/api/test",
    {},
    {
      kind: "json",
      parse: (body) => body,
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.kind, "http");
  assert.equal(result.status, 401);
  assert.equal(result.error, "Unauthorized");
});

test("500 JSON becomes http 500", async () => {
  mock.method(globalThis, "fetch", () =>
    Promise.resolve(jsonResponse({ error: "Server error" }, 500)),
  );
  const result = await apiRequest(
    "/api/test",
    {},
    {
      kind: "json",
      parse: (body) => body,
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.kind, "http");
  assert.equal(result.status, 500);
});

test("200 HTML becomes invalid-response", async () => {
  mock.method(globalThis, "fetch", () =>
    Promise.resolve(
      new Response("<!DOCTYPE html><html><body>Login</body></html>", {
        status: 200,
      }),
    ),
  );
  const result = await apiRequest(
    "/api/test",
    {},
    {
      kind: "json",
      parse: (body) => body,
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.kind, "invalid-response");
  assert.equal(result.status, 200);
});

test("200 invalid JSON becomes invalid-response", async () => {
  mock.method(globalThis, "fetch", () =>
    Promise.resolve(new Response("{not-json", { status: 200 })),
  );
  const result = await apiRequest(
    "/api/test",
    {},
    {
      kind: "json",
      parse: (body) => body,
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.kind, "invalid-response");
});

test("200 schema mismatch becomes invalid-response", async () => {
  mock.method(globalThis, "fetch", () =>
    Promise.resolve(jsonResponse({ wrong: true })),
  );
  const result = await apiRequest(
    "/api/test",
    {},
    {
      kind: "json",
      parse: (body) =>
        typeof body === "object" && body !== null && "expected" in body
          ? (body as { expected: true })
          : null,
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.kind, "invalid-response");
});

test("204 empty succeeds for empty format", async () => {
  mock.method(globalThis, "fetch", () =>
    Promise.resolve(new Response(null, { status: 204 })),
  );
  const result = await deleteNote("note-id");
  assert.equal(result.ok, true);
});

test("2xx empty body on json endpoint becomes invalid-response", async () => {
  mock.method(globalThis, "fetch", () =>
    Promise.resolve(new Response("", { status: 200 })),
  );
  const result = await apiRequest(
    "/api/test",
    {},
    {
      kind: "json",
      parse: (body) => body,
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.kind, "invalid-response");
});

test("fetchMe treats 200 with user null as success", async () => {
  mock.method(globalThis, "fetch", () =>
    Promise.resolve(jsonResponse({ user: null })),
  );
  const result = await fetchMe();
  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }
  assert.equal(result.data.user, null);
});

test("fetchMe does not collapse 401 to guest", async () => {
  mock.method(globalThis, "fetch", () =>
    Promise.resolve(jsonResponse({ error: "Unauthorized" }, 401)),
  );
  const result = await fetchMe();
  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }
  assert.equal(result.kind, "http");
  assert.equal(result.status, 401);
});

test("fetchNotes does not throw on failure", async () => {
  mock.method(globalThis, "fetch", () =>
    Promise.resolve(jsonResponse({ error: "nope" }, 500)),
  );
  const result = await fetchNotes();
  assert.equal(result.ok, false);
});

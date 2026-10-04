import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { testD1 } from "../../scripts/test-d1.mjs";
import {
  authenticateBearer,
  createTokenForUser,
  revokeTokenForUser,
} from "./tokens.ts";

function fixture(t: { after: (fn: () => void) => void }) {
  const database = testD1();
  t.after(() => database.sqlite.close());
  database.sqlite.exec(
    readFileSync(
      new URL("../db/migrations/0001_init.sql", import.meta.url),
      "utf8",
    ),
  );
  database.sqlite.exec(
    "INSERT INTO users (id, email, display_name, created_at) VALUES ('a', 'a@example.invalid', 'Alice', 1), ('b', 'b@example.invalid', 'Bob', 1)",
  );
  return database;
}

const request = (token: string) =>
  new Request("https://md.example.invalid/mcp", {
    headers: { Authorization: `Bearer ${token}` },
  });

test("token lookup and last-use update take one D1 call while identity stays fresh", async (t) => {
  const database = fixture(t);
  const env = database.env as unknown as Env;
  const token = await createTokenForUser(env, "a", "test");
  assert.ok("token" in token);
  const other = await createTokenForUser(env, "b", "other");
  assert.ok("token" in other);
  const before = database.calls;
  assert.deepEqual(await authenticateBearer(request(token.token), env), {
    displayName: "Alice",
    email: "a@example.invalid",
    id: "a",
  });
  assert.equal(database.calls - before, 1);
  const rows = database.sqlite
    .prepare("SELECT user_id, last_used_at FROM api_tokens ORDER BY user_id")
    .all();
  assert.equal(typeof rows[0].last_used_at, "number");
  assert.equal(rows[1].last_used_at, null);
  database.sqlite.exec(
    "UPDATE users SET display_name = 'Renamed' WHERE id = 'a'",
  );
  assert.equal(
    (await authenticateBearer(request(token.token), env))?.displayName,
    "Renamed",
  );
  await revokeTokenForUser(env, "a", token.id);
  assert.equal(await authenticateBearer(request(token.token), env), null);
});

test("missing, unknown and orphaned credentials cannot authenticate or touch other tokens", async (t) => {
  const database = fixture(t);
  const env = database.env as unknown as Env;
  const token = await createTokenForUser(env, "a", "test");
  assert.ok("token" in token);
  const before = database.calls;
  assert.equal(
    await authenticateBearer(
      new Request("https://md.example.invalid/mcp"),
      env,
    ),
    null,
  );
  assert.equal(await authenticateBearer(request(""), env), null);
  assert.equal(database.calls, before);
  assert.equal(
    await authenticateBearer(request("unknown-test-token"), env),
    null,
  );
  assert.equal(
    database.sqlite.prepare("SELECT last_used_at FROM api_tokens").get()
      ?.last_used_at,
    null,
  );
  database.sqlite.exec(
    "PRAGMA foreign_keys = OFF; DELETE FROM users WHERE id = 'a'",
  );
  assert.equal(await authenticateBearer(request(token.token), env), null);
  assert.equal(
    database.sqlite.prepare("SELECT last_used_at FROM api_tokens").get()
      ?.last_used_at,
    null,
  );
});

test("a failed last-use update fails authentication and rolls back the batch", async (t) => {
  const database = fixture(t);
  const env = database.env as unknown as Env;
  const token = await createTokenForUser(env, "a", "test");
  assert.ok("token" in token);
  database.sqlite.exec(
    "CREATE TRIGGER fail_usage BEFORE UPDATE ON api_tokens BEGIN SELECT RAISE(ABORT, 'test failure'); END",
  );
  await assert.rejects(
    authenticateBearer(request(token.token), env),
    /test failure/,
  );
  assert.equal(
    database.sqlite.prepare("SELECT last_used_at FROM api_tokens").get()
      ?.last_used_at,
    null,
  );
});

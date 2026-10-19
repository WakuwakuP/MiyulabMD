import assert from "node:assert/strict";
import { test } from "node:test";
import { testD1 } from "../../scripts/test-d1.mjs";
import { featureConfig } from "./feature-config.ts";

test("one live query keeps feature exposure isolated by owner and follows configuration removal", async (t) => {
  const database = testD1();
  t.after(() => database.sqlite.close());
  database.sqlite.exec(`
    CREATE TABLE para_spaces (owner_id TEXT);
    CREATE TABLE medallion_sets (owner_user_id TEXT);
    CREATE TABLE folders (owner_id TEXT, scheme TEXT);
    INSERT INTO para_spaces VALUES ('a');
    INSERT INTO medallion_sets VALUES ('b');
    INSERT INTO folders VALUES ('a', NULL), ('b', 'decimal');
  `);
  const env = database.env as unknown as Env;
  const user = (id: string) => ({
    displayName: null,
    email: `${id}@example.invalid`,
    id,
  });
  const before = database.calls;
  assert.deepEqual(await featureConfig(env, user("a")), {
    hasMedallion: false,
    hasPara: true,
    hasSchemes: false,
  });
  assert.equal(database.calls - before, 1);
  assert.deepEqual(await featureConfig(env, user("b")), {
    hasMedallion: true,
    hasPara: false,
    hasSchemes: true,
  });
  database.sqlite.exec(
    "DELETE FROM para_spaces; UPDATE folders SET scheme = 'decimal' WHERE owner_id = 'a'",
  );
  assert.deepEqual(await featureConfig(env, user("a")), {
    hasMedallion: false,
    hasPara: false,
    hasSchemes: true,
  });
  const beforeAnonymous = database.calls;
  assert.deepEqual(await featureConfig(env, null), {
    hasMedallion: false,
    hasPara: false,
    hasSchemes: false,
  });
  assert.equal(database.calls, beforeAnonymous);
});

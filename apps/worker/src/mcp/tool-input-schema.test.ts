import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { toolInputSchema } from "./tool-input-schema.ts";

test("shared schema preserves Zod validation, defaults and unknown-key stripping", async () => {
  const shape = {
    id: z.string(),
    limit: z.number().int().min(1).max(200).default(50),
    scope: z.enum(["private", "public"]).optional(),
  };
  const expected = z.object(shape)["~standard"];
  const actual = toolInputSchema(shape)["~standard"];
  for (const value of [
    { extra: "strip me", id: "note" },
    { id: "note", limit: 200, scope: "public" },
    {},
    { id: "note", limit: 201 },
    { id: "note", limit: 1.5 },
    { id: "note", scope: "invalid" },
  ]) {
    assert.deepEqual(
      await actual.validate(value),
      await expected.validate(value),
    );
  }
});

test("canonical input JSON Schema is reused and cannot be mutated across requests", () => {
  const shape = { id: z.string(), limit: z.number().optional() };
  const schema = toolInputSchema(shape)["~standard"];
  const options = { target: "draft-2020-12" };
  const first = schema.jsonSchema.input(options);
  assert.deepEqual(
    first,
    z.object(shape)["~standard"].jsonSchema.input(options),
  );
  assert.equal(schema.jsonSchema.input(options), first);
  assert.ok(Object.isFrozen(first));
  assert.ok(Object.isFrozen(first.properties));
  assert.throws(() => {
    first.properties = {};
  }, TypeError);
});

test("other dialects, output schemas and custom options delegate to Zod", () => {
  const shape = { limit: z.number().default(50) };
  const schema = toolInputSchema(shape)["~standard"];
  const expected = z.object(shape)["~standard"];
  for (const target of ["draft-07", "openapi-3.0"]) {
    assert.deepEqual(
      schema.jsonSchema.input({ target }),
      expected.jsonSchema.input({ target }),
    );
  }
  const options = {
    libraryOptions: { reused: "ref" },
    target: "draft-2020-12",
  };
  assert.deepEqual(
    schema.jsonSchema.input(options),
    expected.jsonSchema.input(options),
  );
  assert.deepEqual(
    schema.jsonSchema.output({ target: "draft-2020-12" }),
    expected.jsonSchema.output({ target: "draft-2020-12" }),
  );
});

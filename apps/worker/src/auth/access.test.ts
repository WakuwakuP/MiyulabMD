import assert from "node:assert/strict";
import { test } from "node:test";
import { emailFromAccessPayload } from "./access.ts";

test("emailFromAccessPayload reads signed email claims only", () => {
  assert.equal(
    emailFromAccessPayload({ email: "user@example.test" }),
    "user@example.test",
  );
  assert.equal(
    emailFromAccessPayload({
      identity: { email: "nested@example.test" },
    }),
    "nested@example.test",
  );
  assert.equal(
    emailFromAccessPayload({ common_name: "device@example.test" }),
    "device@example.test",
  );
});

test("emailFromAccessPayload ignores spoofable headers and email-less tokens", () => {
  assert.equal(
    emailFromAccessPayload({ common_name: "service-token-id" }),
    null,
  );
  assert.equal(
    emailFromAccessPayload({
      "Cf-Access-Authenticated-User-Email": "victim@example.test",
    }),
    null,
  );
  assert.equal(emailFromAccessPayload({ email: "" }), null);
  assert.equal(emailFromAccessPayload({ identity: { email: 1 } }), null);
});

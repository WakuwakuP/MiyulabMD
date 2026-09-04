import assert from "node:assert/strict";
import { test } from "node:test";
import { readTomlQuotedValue } from "./helpers.mjs";
import {
  applyDeployOverrides,
  assertRemoteOverrides,
  PLACEHOLDER_ACCESS_TEAM_DOMAIN,
  PLACEHOLDER_D1_DATABASE_ID,
  readDeployOverridesFromEnv,
} from "./wrangler-config.mjs";

const wranglerToml = `name = "miyulabmd"
database_name = "miyulabmd"
database_id = "${PLACEHOLDER_D1_DATABASE_ID}"
bucket_name = "miyulabmd-images"
service = "miyulabmd-og-fetch"
ACCESS_TEAM_DOMAIN = "example.cloudflareaccess.com"
`;

const ogToml = `name = "miyulabmd-og-fetch"
`;

test("readDeployOverridesFromEnv ignores empty strings", () => {
  assert.deepEqual(
    readDeployOverridesFromEnv({
      D1_DATABASE_ID: " db-1 ",
      WORKER_NAME: "",
      ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
    }),
    {
      workerName: undefined,
      ogFetchName: undefined,
      d1Name: undefined,
      d1Id: "db-1",
      r2Name: undefined,
      accessTeamDomain: "team.cloudflareaccess.com",
      customHostname: undefined,
    },
  );
});

test("applyDeployOverrides only rewrites provided keys", () => {
  const next = applyDeployOverrides(wranglerToml, ogToml, {
    d1Id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    accessTeamDomain: "fork.cloudflareaccess.com",
  });
  assert.equal(readTomlQuotedValue(next.wranglerToml, "name"), "miyulabmd");
  assert.equal(
    readTomlQuotedValue(next.wranglerToml, "database_id"),
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  );
  assert.equal(
    readTomlQuotedValue(next.wranglerToml, "ACCESS_TEAM_DOMAIN"),
    "fork.cloudflareaccess.com",
  );
  assert.equal(readTomlQuotedValue(next.ogToml, "name"), "miyulabmd-og-fetch");
});

test("applyDeployOverrides can rename workers and add a custom domain", () => {
  const next = applyDeployOverrides(wranglerToml, ogToml, {
    workerName: "fork-md",
    ogFetchName: "fork-md-og-fetch",
    customHostname: "md.fork.dev",
  });
  assert.equal(readTomlQuotedValue(next.wranglerToml, "name"), "fork-md");
  assert.equal(
    readTomlQuotedValue(next.wranglerToml, "service"),
    "fork-md-og-fetch",
  );
  assert.equal(readTomlQuotedValue(next.ogToml, "name"), "fork-md-og-fetch");
  assert.match(next.wranglerToml, /pattern = "md\.fork\.dev"/);
});

test("assertRemoteOverrides rejects the shared placeholder", () => {
  assert.throws(
    () => assertRemoteOverrides({ d1Id: PLACEHOLDER_D1_DATABASE_ID }),
    /D1_DATABASE_ID/,
  );
  assert.throws(
    () =>
      assertRemoteOverrides({
        d1Id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        accessTeamDomain: PLACEHOLDER_ACCESS_TEAM_DOMAIN,
      }),
    /ACCESS_TEAM_DOMAIN/,
  );
  assert.doesNotThrow(() =>
    assertRemoteOverrides({
      d1Id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      accessTeamDomain: "fork.cloudflareaccess.com",
    }),
  );
});

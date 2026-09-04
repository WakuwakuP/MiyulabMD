import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ACCESS_TOKEN_PERMISSIONS,
  accessAuthDestination,
  buildUserTokenTemplateUrl,
  extractJson,
  isDurableApiToken,
  normalizeHostname,
  normalizeTeamDomain,
  parseAccessIncludes,
  parseGitHubRemote,
  readTomlQuotedValue,
  replaceTomlQuotedValue,
  slugifyTeamName,
  upsertCustomDomainRoute,
  workersDevHostname,
} from "./helpers.mjs";

test("extractJson skips wrangler banner text", () => {
  const text = `⛅️ wrangler 4.127.1
────────────────────
{ "type": "oauth", "token": "cfut_test" }
`;
  assert.deepEqual(extractJson(text), { type: "oauth", token: "cfut_test" });
});

test("extractJson reads a JSON array", () => {
  assert.deepEqual(extractJson('ok\n[{"uuid":"abc"}]\n'), [{ uuid: "abc" }]);
});

test("toml quoted value read and replace keep surrounding keys", () => {
  const source = `name = "miyulabmd"
database_id = "old-id"
ACCESS_TEAM_DOMAIN = "example.cloudflareaccess.com"
`;
  assert.equal(readTomlQuotedValue(source, "database_id"), "old-id");
  const next = replaceTomlQuotedValue(source, "database_id", "new-id");
  assert.equal(readTomlQuotedValue(next, "database_id"), "new-id");
  assert.equal(readTomlQuotedValue(next, "name"), "miyulabmd");
});

test("upsertCustomDomainRoute appends then updates", () => {
  const source = `name = "miyulabmd"\n`;
  const added = upsertCustomDomainRoute(source, "md.example.com");
  assert.match(
    added,
    /\[\[routes\]\]\npattern = "md\.example\.com"\ncustom_domain = true\n/,
  );
  const updated = upsertCustomDomainRoute(added, "notes.example.com");
  assert.match(updated, /pattern = "notes\.example\.com"/);
  assert.equal(updated.includes("md.example.com"), false);
});

test("parseGitHubRemote accepts ssh and https", () => {
  assert.deepEqual(
    parseGitHubRemote("git@github.com:WakuwakuP/MiyulabMD.git"),
    {
      owner: "WakuwakuP",
      name: "MiyulabMD",
    },
  );
  assert.deepEqual(parseGitHubRemote("https://github.com/someone/MiyulabMD"), {
    owner: "someone",
    name: "MiyulabMD",
  });
  assert.deepEqual(parseGitHubRemote("ssh://git@github.com/someone/fork"), {
    owner: "someone",
    name: "fork",
  });
});

test("team domain and hostname helpers", () => {
  assert.equal(slugifyTeamName("My Team!!"), "my-team");
  assert.equal(normalizeTeamDomain("My Team"), "my-team.cloudflareaccess.com");
  assert.equal(
    normalizeTeamDomain("https://acme.cloudflareaccess.com/"),
    "acme.cloudflareaccess.com",
  );
  assert.equal(
    normalizeHostname("https://md.example.com/path"),
    "md.example.com",
  );
  assert.equal(accessAuthDestination("md.example.com"), "md.example.com/auth*");
  assert.equal(
    workersDevHostname("miyulabmd", "my-sub"),
    "miyulabmd.my-sub.workers.dev",
  );
});

test("parseAccessIncludes maps emails, domains, and everyone", () => {
  assert.deepEqual(parseAccessIncludes("everyone"), [{ everyone: {} }]);
  assert.deepEqual(parseAccessIncludes("a@example.com, @team.dev"), [
    { email: { email: "a@example.com" } },
    { email_domain: { domain: "team.dev" } },
  ]);
});

test("token template URL encodes permissions and account", () => {
  const url = buildUserTokenTemplateUrl({
    name: "MiyulabMD GitHub Actions",
    accountId: "acc123",
    permissions: ACCESS_TOKEN_PERMISSIONS,
  });
  assert.ok(url.startsWith("https://dash.cloudflare.com/profile/api-tokens?"));
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get("accountId"), "acc123");
  assert.equal(parsed.searchParams.get("name"), "MiyulabMD GitHub Actions");
  const keys = JSON.parse(parsed.searchParams.get("permissionGroupKeys"));
  assert.ok(keys.some((item) => item.key === "access" && item.type === "edit"));
  assert.ok(keys.some((item) => item.key === "d1" && item.type === "edit"));
});

test("isDurableApiToken rejects oauth", () => {
  assert.equal(isDurableApiToken({ type: "oauth", token: "x" }), false);
  assert.equal(isDurableApiToken({ type: "api_token", token: "x" }), true);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { handleAuthRequest, handleEstablishSession } from "../routes/auth.ts";
import { createSessionToken } from "./session.ts";

const sessionEnv = {
  ACCESS_AUD: "",
  ACCESS_TEAM_DOMAIN: "example.cloudflareaccess.com",
  DEV_AUTH: "true",
  SESSION_SECRET: "establish-test-secret-not-a-production-credential",
} as Env;

const accessEnv = {
  ACCESS_AUD: "test-audience",
  ACCESS_TEAM_DOMAIN: "login-test.cloudflareaccess.com",
  DEV_AUTH: "true",
  SESSION_SECRET: "establish-test-secret-not-a-production-credential",
} as Env;

test("mock login is ignored when Access is configured even with X-Dev-User-Email", async () => {
  const response = await handleAuthRequest(
    new Request("https://notes.test/auth/login", {
      headers: { "X-Dev-User-Email": "victim@example.test" },
    }),
    accessEnv,
  );
  assert.equal(response?.status, 302);
  assert.match(
    response?.headers.get("Location") ?? "",
    /login-test\.cloudflareaccess\.com\/cdn-cgi\/access\/login/,
  );
  assert.equal(response?.headers.get("Set-Cookie"), null);
});

test("establish rejects a cross-site Origin", async () => {
  const token = await createSessionToken(
    { displayName: "Eve", email: "eve@example.test", id: "eve" },
    sessionEnv,
  );
  const response = await handleEstablishSession(
    new Request("https://notes.test/api/auth/establish", {
      body: new URLSearchParams({ token }).toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://evil.example",
      },
      method: "POST",
    }),
    sessionEnv,
  );
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Set-Cookie"), null);
});

test("establish rejects Sec-Fetch-Site cross-site", async () => {
  const token = await createSessionToken(
    { displayName: "Eve", email: "eve@example.test", id: "eve" },
    sessionEnv,
  );
  const response = await handleEstablishSession(
    new Request("https://notes.test/api/auth/establish", {
      body: new URLSearchParams({ token }).toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Sec-Fetch-Site": "cross-site",
      },
      method: "POST",
    }),
    sessionEnv,
  );
  assert.equal(response.status, 403);
});

test("establish accepts a same-origin form POST", async () => {
  const token = await createSessionToken(
    { displayName: "Ada", email: "ada@example.test", id: "ada" },
    sessionEnv,
  );
  const response = await handleEstablishSession(
    new Request("https://notes.test/api/auth/establish", {
      body: new URLSearchParams({ token }).toString(),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://notes.test",
        "Sec-Fetch-Site": "same-origin",
      },
      method: "POST",
    }),
    sessionEnv,
  );
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("Location"), "/");
  assert.match(response.headers.get("Set-Cookie") ?? "", /miyulabmd_session=/);
});

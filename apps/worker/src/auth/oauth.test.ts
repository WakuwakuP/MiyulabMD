import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { testD1 } from "../../scripts/test-d1.mjs";
import { handleEstablishSession } from "../routes/auth.ts";
import { handleOAuthHttp } from "./oauth.ts";
import {
  authorizationServerMetadata,
  oauthNextCookie,
  protectedResourceMetadata,
  safeOAuthReturnPath,
  wwwAuthenticate,
} from "./oauth-policy.ts";
import { createSessionToken, sessionCookieFromToken } from "./session.ts";
import { authenticateBearer } from "./tokens.ts";

const ORIGIN = "https://md.example.invalid";
const RESOURCE = `${ORIGIN}/mcp`;
const REDIRECT = "https://chatgpt.com/connector_platform_oauth_redirect";
const VERIFIER = "a".repeat(64);

function challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

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
    readFileSync(
      new URL("../db/migrations/0020_oauth.sql", import.meta.url),
      "utf8",
    ),
  );
  database.sqlite.exec(
    "INSERT INTO users (id, email, display_name, created_at) VALUES ('user', 'a@example.invalid', 'Alice', 1)",
  );
  const env = {
    ...database.env,
    SESSION_SECRET: "oauth-test-secret-not-a-production-credential",
  } as unknown as Env;
  return { database, env };
}

async function sessionCookie(env: Env): Promise<string> {
  const token = await createSessionToken(
    { displayName: "Alice", email: "a@example.invalid", id: "user" },
    env,
  );
  return sessionCookieFromToken(token, true);
}

function authorizeQuery(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    code_challenge: challenge(VERIFIER),
    code_challenge_method: "S256",
    redirect_uri: REDIRECT,
    resource: RESOURCE,
    response_type: "code",
    scope: "mcp",
    state: "xyz",
  });
  return params.toString();
}

test("discovery documents point ChatGPT at this origin", () => {
  const resource = protectedResourceMetadata(ORIGIN);
  assert.equal(resource.resource, RESOURCE);
  assert.deepEqual(resource.authorization_servers, [ORIGIN]);
  const server = authorizationServerMetadata(ORIGIN);
  assert.equal(server.issuer, ORIGIN);
  assert.equal(server.authorization_response_iss_parameter_supported, true);
  assert.equal(server.client_id_metadata_document_supported, true);
  assert.deepEqual(server.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(server.token_endpoint_auth_methods_supported, ["none"]);
  assert.equal(
    wwwAuthenticate(ORIGIN, false).includes("resource_metadata="),
    true,
  );
  assert.equal(wwwAuthenticate(ORIGIN, true).includes("invalid_token"), true);
});

test("wrangler routes OAuth discovery to the Worker ahead of the SPA", () => {
  const toml = readFileSync(
    new URL("../../wrangler.toml", import.meta.url),
    "utf8",
  );
  for (const route of [
    "/.well-known/oauth-protected-resource",
    "/.well-known/oauth-protected-resource/*",
    "/.well-known/oauth-authorization-server",
    "/oauth/authorize",
    "/oauth/token",
    "/oauth/register",
  ]) {
    assert.ok(toml.includes(`"${route}"`), route);
  }
});

test("dynamic registration, consent, PKCE exchange, and refresh", async (t) => {
  const { database, env } = fixture(t);
  const registered = await handleOAuthHttp(
    new Request(`${ORIGIN}/oauth/register`, {
      body: JSON.stringify({
        client_name: "ChatGPT",
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: "none",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    }),
    env,
  );
  assert.equal(registered.status, 201);
  const client = (await registered.json()) as { client_id: string };
  const cookie = await sessionCookie(env);
  const query = authorizeQuery(client.client_id);
  const consent = await handleOAuthHttp(
    new Request(`${ORIGIN}/oauth/authorize?${query}`, {
      headers: { Cookie: cookie },
    }),
    env,
  );
  assert.equal(consent.status, 200);
  assert.match(await consent.text(), /許可する/);

  const allowed = await handleOAuthHttp(
    new Request(`${ORIGIN}/oauth/authorize`, {
      body: new URLSearchParams({
        client_id: client.client_id,
        code_challenge: challenge(VERIFIER),
        code_challenge_method: "S256",
        decision: "allow",
        redirect_uri: REDIRECT,
        resource: RESOURCE,
        response_type: "code",
        scope: "mcp",
        state: "xyz",
      }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
      },
      method: "POST",
    }),
    env,
  );
  assert.equal(allowed.status, 302);
  const redirected = new URL(allowed.headers.get("Location") ?? "");
  assert.equal(redirected.searchParams.get("iss"), ORIGIN);
  assert.equal(redirected.searchParams.get("state"), "xyz");
  const code = redirected.searchParams.get("code");
  assert.ok(code);

  const tokenResponse = await exchange(env, client.client_id, code);
  assert.equal(tokenResponse.status, 200);
  const token = (await tokenResponse.json()) as {
    access_token: string;
    refresh_token: string;
    token_type: string;
  };
  assert.equal(token.token_type, "Bearer");
  assert.equal(token.access_token.startsWith("mlo_"), true);

  const user = await authenticateBearer(
    new Request(`${RESOURCE}`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    }),
    env,
  );
  assert.equal(user?.email, "a@example.invalid");
  assert.equal(
    await authenticateBearer(
      new Request(`${ORIGIN}/api/articles`, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      }),
      env,
    ),
    null,
  );

  const reused = await exchange(env, client.client_id, code);
  assert.equal(reused.status, 400);

  const refreshed = await handleOAuthHttp(
    new Request(`${ORIGIN}/oauth/token`, {
      body: new URLSearchParams({
        client_id: client.client_id,
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
        resource: RESOURCE,
      }),
      method: "POST",
    }),
    env,
  );
  assert.equal(refreshed.status, 200);
  const next = (await refreshed.json()) as { refresh_token: string };
  const again = await handleOAuthHttp(
    new Request(`${ORIGIN}/oauth/token`, {
      body: new URLSearchParams({
        client_id: client.client_id,
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
        resource: RESOURCE,
      }),
      method: "POST",
    }),
    env,
  );
  assert.equal(again.status, 400);

  (env.DB as { batch: () => Promise<unknown> }).batch = () =>
    Promise.reject(new Error("batch failed"));
  await assert.rejects(
    handleOAuthHttp(
      new Request(`${ORIGIN}/oauth/token`, {
        body: new URLSearchParams({
          client_id: client.client_id,
          grant_type: "refresh_token",
          refresh_token: next.refresh_token,
          resource: RESOURCE,
        }),
        method: "POST",
      }),
      env,
    ),
  );
  const hash = createHash("sha256").update(next.refresh_token).digest("hex");
  const stored = database.sqlite
    .prepare("SELECT rotated_at FROM oauth_refresh_tokens WHERE token_hash = ?")
    .get(hash) as { rotated_at: number | null };
  assert.equal(stored.rotated_at, null);
});

test("PKCE mismatch and foreign redirect URIs are rejected", async (t) => {
  const { env } = fixture(t);
  const registered = await handleOAuthHttp(
    new Request(`${ORIGIN}/oauth/register`, {
      body: JSON.stringify({ redirect_uris: [REDIRECT] }),
      method: "POST",
    }),
    env,
  );
  const client = (await registered.json()) as { client_id: string };
  const cookie = await sessionCookie(env);
  const query = authorizeQuery(client.client_id);
  const allowed = await handleOAuthHttp(
    new Request(`${ORIGIN}/oauth/authorize`, {
      body: new URLSearchParams({
        client_id: client.client_id,
        code_challenge: challenge(VERIFIER),
        code_challenge_method: "S256",
        decision: "allow",
        redirect_uri: REDIRECT,
        resource: RESOURCE,
        response_type: "code",
        state: "xyz",
      }),
      headers: { Cookie: cookie },
      method: "POST",
    }),
    env,
  );
  const code = new URL(allowed.headers.get("Location") ?? "").searchParams.get(
    "code",
  );
  assert.ok(code);
  const wrong = await handleOAuthHttp(
    new Request(`${ORIGIN}/oauth/token`, {
      body: new URLSearchParams({
        client_id: client.client_id,
        code,
        code_verifier: "b".repeat(64),
        grant_type: "authorization_code",
        redirect_uri: REDIRECT,
        resource: RESOURCE,
      }),
      method: "POST",
    }),
    env,
  );
  assert.equal(wrong.status, 400);

  const foreignParams = new URLSearchParams(query);
  foreignParams.set("redirect_uri", "https://evil.example/callback");
  const foreign = await handleOAuthHttp(
    new Request(`${ORIGIN}/oauth/authorize?${foreignParams}`, {
      headers: { Cookie: cookie },
    }),
    env,
  );
  assert.equal(foreign.status, 400);
  assert.equal(
    (
      await handleOAuthHttp(
        new Request(`${ORIGIN}/oauth/register`, {
          body: JSON.stringify({
            redirect_uris: ["http://evil.example/callback"],
          }),
          method: "POST",
        }),
        env,
      )
    ).status,
    400,
  );
});

test("CIMD client_id is fetched and private hosts are not", async (t) => {
  const { env } = fixture(t);
  const clientId = "https://chatgpt.com/oauth/client.json";
  let fetched = 0;
  const deps = {
    fetch: () => {
      fetched += 1;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            client_id: clientId,
            client_name: "ChatGPT",
            redirect_uris: [REDIRECT],
            token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );
    },
  };
  const cookie = await sessionCookie(env);
  const ok = await handleOAuthHttp(
    new Request(`${ORIGIN}/oauth/authorize?${authorizeQuery(clientId)}`, {
      headers: { Cookie: cookie },
    }),
    env,
    deps,
  );
  assert.equal(ok.status, 200);
  assert.equal(fetched, 1);
  const blocked = await handleOAuthHttp(
    new Request(
      `${ORIGIN}/oauth/authorize?${authorizeQuery("https://127.0.0.1/client.json")}`,
      { headers: { Cookie: cookie } },
    ),
    env,
    deps,
  );
  assert.equal(blocked.status, 400);
  assert.equal(fetched, 1);
});

test("anonymous authorize returns to login and establish resumes consent", async (t) => {
  const { env } = fixture(t);
  const clientId = "https://chatgpt.com/oauth/client.json";
  const query = authorizeQuery(clientId);
  const deps = {
    fetch: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            client_id: clientId,
            client_name: "ChatGPT",
            redirect_uris: [REDIRECT],
            token_endpoint_auth_method: "none",
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
      ),
  };
  const anonymous = await handleOAuthHttp(
    new Request(`${ORIGIN}/oauth/authorize?${query}`),
    env,
    deps,
  );
  assert.equal(anonymous.status, 302);
  assert.equal(anonymous.headers.get("Location"), "/auth/login");
  const next = anonymous.headers.get("Set-Cookie") ?? "";
  assert.match(next, /miyulabmd_oauth_next=/);
  assert.equal(
    safeOAuthReturnPath("https://evil.example/oauth/authorize?client_id=1"),
    null,
  );
  assert.equal(
    safeOAuthReturnPath(`/oauth/authorize?${query}`)?.startsWith(
      "/oauth/authorize?",
    ),
    true,
  );

  const session = await createSessionToken(
    { displayName: "Alice", email: "a@example.invalid", id: "user" },
    env,
  );
  const established = await handleEstablishSession(
    new Request(`${ORIGIN}/api/auth/establish`, {
      body: new URLSearchParams({ token: session }),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: oauthNextCookie(`/oauth/authorize?${query}`, true),
      },
      method: "POST",
    }),
    env,
  );
  assert.equal(established.status, 302);
  assert.equal(
    established.headers.get("Location"),
    `/oauth/authorize?${query}`,
  );
});

function exchange(env: Env, clientId: string, code: string): Promise<Response> {
  return handleOAuthHttp(
    new Request(`${ORIGIN}/oauth/token`, {
      body: new URLSearchParams({
        client_id: clientId,
        code,
        code_verifier: VERIFIER,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT,
        resource: RESOURCE,
      }),
      method: "POST",
    }),
    env,
  );
}

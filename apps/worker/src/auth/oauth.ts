import type { SessionUser } from "@miyulabmd/shared";

import { db } from "../db/client.ts";
import {
  authorizationServerMetadata,
  isAllowedRedirectUri,
  isPublicHttpsUrl,
  MCP_SCOPE,
  mcpResource,
  normalizeScope,
  oauthNextCookie,
  protectedResourceMetadata,
  randomToken,
  redirectListed,
  s256Challenge,
  safeOAuthReturnPath,
  sha256Hex,
  validCodeVerifier,
} from "./oauth-policy.ts";
import { readSession } from "./session.ts";

const CODE_TTL_MS = 10 * 60 * 1000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type OAuthDeps = {
  fetch?: typeof fetch;
  now?: () => number;
};

type ResolvedClient = {
  id: string;
  name: string;
  redirectUris: string[];
};

type AuthCodeRow = {
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  scope: string;
  expires_at: number;
};

type RefreshRow = {
  user_id: string;
  client_id: string;
  resource: string;
  scope: string;
  expires_at: number;
  rotated_at: number | null;
};

export function handleOAuthHttp(
  request: Request,
  env: Env,
  deps: OAuthDeps = {},
): Response | Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  if (
    pathname === "/.well-known/oauth-protected-resource" ||
    pathname === "/.well-known/oauth-protected-resource/mcp"
  ) {
    if (request.method !== "GET") {
      return methodNotAllowed("GET");
    }
    return oauthJson(protectedResourceMetadata(url.origin), 200, true);
  }
  if (pathname === "/.well-known/oauth-authorization-server") {
    if (request.method !== "GET") {
      return methodNotAllowed("GET");
    }
    return oauthJson(authorizationServerMetadata(url.origin), 200, true);
  }
  if (pathname === "/oauth/register") {
    return handleRegister(request, env, deps);
  }
  if (pathname === "/oauth/token") {
    return handleToken(request, env, deps);
  }
  if (pathname === "/oauth/authorize") {
    return handleAuthorize(request, env, deps);
  }
  return new Response("Not found", { status: 404 });
}

/** Opaque MCP access tokens (`mlo_`). PAT lookup stays in tokens.ts. */
export async function authenticateOAuthBearer(
  request: Request,
  env: Env,
  plaintext: string,
): Promise<SessionUser | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/mcp" && !url.pathname.startsWith("/mcp/")) {
    return null;
  }
  const tokenHash = await sha256Hex(plaintext);
  const now = Date.now();
  const resource = mcpResource(url.origin);
  const database = db(env);
  const [lookup] = await database.batch<{
    user_id: string;
    email: string;
    display_name: string | null;
  }>([
    database
      .prepare(
        `SELECT t.user_id, u.email, u.display_name
         FROM oauth_access_tokens t
         INNER JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = ? AND t.expires_at > ? AND t.resource = ?`,
      )
      .bind(tokenHash, now, resource),
    database
      .prepare(
        `UPDATE oauth_access_tokens SET last_used_at = ?
         WHERE token_hash = ? AND expires_at > ? AND resource = ?
           AND EXISTS (
             SELECT 1 FROM users u WHERE u.id = oauth_access_tokens.user_id
           )`,
      )
      .bind(now, tokenHash, now, resource),
  ]);
  const row = lookup?.results[0];
  if (!row) {
    return null;
  }
  return {
    displayName: row.display_name,
    email: row.email,
    id: row.user_id,
  };
}

async function handleRegister(
  request: Request,
  env: Env,
  deps: OAuthDeps,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return preflight("POST");
  }
  if (request.method !== "POST") {
    return methodNotAllowed("POST");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return oauthError(400, "invalid_client_metadata", "Body must be JSON");
  }
  if (!isRecord(body)) {
    return oauthError(400, "invalid_client_metadata", "Body must be an object");
  }
  const redirectUris = stringList(body.redirect_uris);
  if (!redirectUris || redirectUris.length === 0) {
    return oauthError(
      400,
      "invalid_client_metadata",
      "redirect_uris is required",
    );
  }
  if (redirectUris.some((uri) => !isAllowedRedirectUri(uri))) {
    return oauthError(
      400,
      "invalid_redirect_uri",
      "redirect_uris must be https or loopback http",
    );
  }
  if (!(allowsNone(body) && allowsCodeGrant(body))) {
    return oauthError(
      400,
      "invalid_client_metadata",
      "Only public authorization-code clients are accepted",
    );
  }
  const clientName = optionalName(body.client_name);
  if (clientName === false) {
    return oauthError(400, "invalid_client_metadata", "client_name is invalid");
  }
  const id = crypto.randomUUID();
  const now = clock(deps);
  await db(env)
    .prepare(
      `INSERT INTO oauth_clients (id, client_name, redirect_uris, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(id, clientName, JSON.stringify(redirectUris), now)
    .run();
  return oauthJson(
    {
      client_id: id,
      client_name: clientName,
      grant_types: ["authorization_code", "refresh_token"],
      redirect_uris: redirectUris,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    201,
  );
}

async function handleAuthorize(
  request: Request,
  env: Env,
  deps: OAuthDeps,
): Promise<Response> {
  const url = new URL(request.url);
  const params =
    request.method === "POST" ? await readForm(request) : url.searchParams;
  if (request.method !== "GET" && request.method !== "POST") {
    return methodNotAllowed("GET, POST");
  }
  const fields = readAuthorizeFields(params, url.origin);
  if ("error" in fields) {
    return new Response(fields.error, {
      headers: { "Cache-Control": "no-store" },
      status: 400,
    });
  }
  const client = await resolveClient(fields.clientId, env, deps);
  if (!(client && redirectListed(client.redirectUris, fields.redirectUri))) {
    return new Response("Unknown client or redirect_uri", {
      headers: { "Cache-Control": "no-store" },
      status: 400,
    });
  }
  if (fields.problem) {
    return authorizationError(fields, fields.problem);
  }

  const user = await readSession(request, env);
  const secure = url.protocol === "https:";
  if (!user) {
    const next = safeOAuthReturnPath(`${url.pathname}${url.search}`);
    const headers = new Headers({
      "Cache-Control": "no-store",
      Location: "/auth/login",
    });
    if (next) {
      headers.append("Set-Cookie", oauthNextCookie(next, secure));
    }
    return new Response(null, { headers, status: 302 });
  }

  if (request.method === "GET") {
    return consentPage(fields, client);
  }

  const decision = params.get("decision");
  if (decision === "deny") {
    return authorizationError(fields, "access_denied");
  }
  if (decision !== "allow") {
    return consentPage(fields, client);
  }

  const code = randomToken("");
  const now = clock(deps);
  await db(env)
    .prepare(
      `INSERT INTO oauth_authorization_codes (
         code_hash, client_id, user_id, redirect_uri, code_challenge,
         resource, scope, expires_at, consumed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      await sha256Hex(code),
      fields.clientId,
      user.id,
      fields.redirectUri,
      fields.codeChallenge,
      fields.resource,
      fields.scope,
      now + CODE_TTL_MS,
    )
    .run();

  const redirect = new URL(fields.redirectUri);
  redirect.searchParams.set("code", code);
  redirect.searchParams.set("iss", url.origin);
  if (fields.state) {
    redirect.searchParams.set("state", fields.state);
  }
  return redirectResponse(redirect);
}

async function handleToken(
  request: Request,
  env: Env,
  deps: OAuthDeps,
): Promise<Response> {
  if (request.method === "OPTIONS") {
    return preflight("POST");
  }
  if (request.method !== "POST") {
    return methodNotAllowed("POST");
  }
  if (request.headers.get("Authorization")) {
    return oauthError(401, "invalid_client", "Public clients use PKCE only");
  }
  const form = await readForm(request);
  if (form.get("client_secret")) {
    return oauthError(401, "invalid_client", "Public clients use PKCE only");
  }
  const grant = form.get("grant_type");
  if (grant === "authorization_code") {
    return exchangeCode(form, env, deps);
  }
  if (grant === "refresh_token") {
    return exchangeRefresh(form, env, deps);
  }
  return oauthError(400, "unsupported_grant_type", "Unsupported grant_type");
}

async function exchangeCode(
  form: URLSearchParams,
  env: Env,
  deps: OAuthDeps,
): Promise<Response> {
  const clientId = form.get("client_id") ?? "";
  const code = form.get("code") ?? "";
  const redirectUri = form.get("redirect_uri") ?? "";
  const verifier = form.get("code_verifier") ?? "";
  const resource = form.get("resource") ?? "";
  if (!(clientId && code && redirectUri && verifier && resource)) {
    return oauthError(400, "invalid_request", "Missing token parameters");
  }
  if (!validCodeVerifier(verifier)) {
    return oauthError(400, "invalid_grant", "code_verifier is invalid");
  }
  const client = await resolveClient(clientId, env, deps);
  if (!(client && redirectListed(client.redirectUris, redirectUri))) {
    return oauthError(400, "invalid_client", "Unknown client");
  }
  const now = clock(deps);
  const codeHash = await sha256Hex(code);
  const row = await db(env)
    .prepare(
      `SELECT client_id, user_id, redirect_uri, code_challenge, resource, scope, expires_at
       FROM oauth_authorization_codes
       WHERE code_hash = ? AND consumed_at IS NULL AND expires_at > ?`,
    )
    .bind(codeHash, now)
    .first<AuthCodeRow>();
  if (!row) {
    return oauthError(400, "invalid_grant", "Authorization code is invalid");
  }
  const challenge = await s256Challenge(verifier);
  const matches =
    row.client_id === clientId &&
    row.redirect_uri === redirectUri &&
    row.resource === resource &&
    row.code_challenge === challenge;
  if (!matches) {
    await db(env)
      .prepare(
        `UPDATE oauth_authorization_codes SET consumed_at = ?
         WHERE code_hash = ? AND consumed_at IS NULL`,
      )
      .bind(now, codeHash)
      .run();
    return oauthError(400, "invalid_grant", "Authorization code is invalid");
  }
  const claim = claimMarker();
  const issued = await issueTokens(
    env,
    now,
    {
      clientId,
      resource: row.resource,
      scope: row.scope,
      userId: row.user_id,
    },
    {
      binds: [claim, codeHash],
      existsBinds: [codeHash, claim],
      existsSql: `SELECT 1 FROM oauth_authorization_codes
         WHERE code_hash = ? AND consumed_at = ?`,
      sql: `UPDATE oauth_authorization_codes SET consumed_at = ?
         WHERE code_hash = ? AND consumed_at IS NULL
         RETURNING code_hash`,
    },
  );
  return (
    issued ?? oauthError(400, "invalid_grant", "Authorization code was used")
  );
}

async function exchangeRefresh(
  form: URLSearchParams,
  env: Env,
  deps: OAuthDeps,
): Promise<Response> {
  const clientId = form.get("client_id") ?? "";
  const refresh = form.get("refresh_token") ?? "";
  const resource = form.get("resource");
  if (!(clientId && refresh)) {
    return oauthError(400, "invalid_request", "Missing refresh parameters");
  }
  const client = await resolveClient(clientId, env, deps);
  if (!client) {
    return oauthError(400, "invalid_client", "Unknown client");
  }
  const now = clock(deps);
  const row = await db(env)
    .prepare(
      `SELECT user_id, client_id, resource, scope, expires_at, rotated_at
       FROM oauth_refresh_tokens
       WHERE token_hash = ?`,
    )
    .bind(await sha256Hex(refresh))
    .first<RefreshRow>();
  if (!row) {
    return oauthError(400, "invalid_grant", "Refresh token is invalid");
  }
  if (row.rotated_at !== null) {
    await revokeGrant(env, row.user_id, row.client_id, now);
    return oauthError(400, "invalid_grant", "Refresh token is invalid");
  }
  if (
    row.client_id !== clientId ||
    row.expires_at <= now ||
    (resource !== null && resource !== row.resource)
  ) {
    return oauthError(400, "invalid_grant", "Refresh token is invalid");
  }
  const refreshHash = await sha256Hex(refresh);
  const claim = claimMarker();
  const issued = await issueTokens(
    env,
    now,
    {
      clientId,
      resource: row.resource,
      scope: row.scope,
      userId: row.user_id,
    },
    {
      binds: [claim, refreshHash],
      existsBinds: [refreshHash, claim],
      existsSql: `SELECT 1 FROM oauth_refresh_tokens
         WHERE token_hash = ? AND rotated_at = ?`,
      sql: `UPDATE oauth_refresh_tokens SET rotated_at = ?
         WHERE token_hash = ? AND rotated_at IS NULL
         RETURNING token_hash`,
    },
  );
  return issued ?? oauthError(400, "invalid_grant", "Refresh token was used");
}

/** RFC 9700: presenting a rotated refresh token revokes that grant. */
async function revokeGrant(
  env: Env,
  userId: string,
  clientId: string,
  now: number,
): Promise<void> {
  const database = db(env);
  await database.batch([
    database
      .prepare(
        `DELETE FROM oauth_refresh_tokens
         WHERE user_id = ? AND client_id = ?`,
      )
      .bind(userId, clientId),
    database
      .prepare(
        `DELETE FROM oauth_access_tokens
         WHERE user_id = ? AND client_id = ?`,
      )
      .bind(userId, clientId),
    database
      .prepare(
        `UPDATE oauth_authorization_codes SET consumed_at = ?
         WHERE user_id = ? AND client_id = ? AND consumed_at IS NULL`,
      )
      .bind(now, userId, clientId),
  ]);
}

type TokenClaim = {
  sql: string;
  binds: unknown[];
  existsSql: string;
  existsBinds: unknown[];
};

/** Claim the previous credential and insert the new pair in one D1 batch. */
async function issueTokens(
  env: Env,
  now: number,
  issued: { userId: string; clientId: string; resource: string; scope: string },
  claim: TokenClaim,
): Promise<Response | null> {
  const access = randomToken("mlo_");
  const refresh = randomToken("mlr_");
  const accessHash = await sha256Hex(access);
  const refreshHash = await sha256Hex(refresh);
  const database = db(env);
  const inserted = await database.batch<{ token_hash: string }>([
    database.prepare(claim.sql).bind(...claim.binds),
    database
      .prepare(
        `INSERT INTO oauth_access_tokens (
           token_hash, user_id, client_id, resource, scope, expires_at, created_at, last_used_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, NULL
         WHERE EXISTS (${claim.existsSql})
         RETURNING token_hash`,
      )
      .bind(
        accessHash,
        issued.userId,
        issued.clientId,
        issued.resource,
        issued.scope,
        now + ACCESS_TTL_MS,
        now,
        ...claim.existsBinds,
      ),
    database
      .prepare(
        `INSERT INTO oauth_refresh_tokens (
           token_hash, user_id, client_id, resource, scope, expires_at, created_at, rotated_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, NULL
         WHERE EXISTS (${claim.existsSql})
         RETURNING token_hash`,
      )
      .bind(
        refreshHash,
        issued.userId,
        issued.clientId,
        issued.resource,
        issued.scope,
        now + REFRESH_TTL_MS,
        now,
        ...claim.existsBinds,
      ),
  ]);
  if (!inserted[1]?.results[0]) {
    return null;
  }
  return oauthJson({
    access_token: access,
    expires_in: ACCESS_TTL_MS / 1000,
    refresh_token: refresh,
    scope: issued.scope,
    token_type: "Bearer",
  });
}

type AuthorizeFields = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  state: string | null;
  issuer: string;
  problem: string | null;
};

function readAuthorizeFields(
  params: URLSearchParams,
  issuer: string,
): AuthorizeFields | { error: string } {
  const clientId = params.get("client_id") ?? "";
  const redirectUri = params.get("redirect_uri") ?? "";
  if (!(clientId && redirectUri)) {
    return { error: "client_id and redirect_uri are required" };
  }
  if (clientId.length > 2048 || redirectUri.length > 2048) {
    return { error: "client_id or redirect_uri is too long" };
  }
  const scope = normalizeScope(params.get("scope"));
  const state = params.get("state");
  const resource = params.get("resource") ?? "";
  const challenge = params.get("code_challenge") ?? "";
  const problem = authorizeProblem(
    params,
    issuer,
    scope,
    state,
    resource,
    challenge,
  );
  return {
    clientId,
    codeChallenge: challenge,
    issuer,
    problem,
    redirectUri,
    resource,
    scope: scope ?? MCP_SCOPE,
    state,
  };
}

function authorizeProblem(
  params: URLSearchParams,
  issuer: string,
  scope: string | null,
  state: string | null,
  resource: string,
  challenge: string,
): string | null {
  if (params.get("response_type") !== "code") {
    return "unsupported_response_type";
  }
  if (scope === null) {
    return "invalid_scope";
  }
  if (resource !== mcpResource(issuer)) {
    return "invalid_target";
  }
  if (params.get("code_challenge_method") !== "S256" || !challenge) {
    return "invalid_request";
  }
  if (state !== null && !safeState(state)) {
    return "invalid_request";
  }
  return null;
}

function authorizationError(fields: AuthorizeFields, error: string): Response {
  const redirect = new URL(fields.redirectUri);
  redirect.searchParams.set("error", error);
  redirect.searchParams.set("iss", fields.issuer);
  if (fields.state) {
    redirect.searchParams.set("state", fields.state);
  }
  return redirectResponse(redirect);
}

function consentPage(
  fields: AuthorizeFields,
  client: ResolvedClient,
): Response {
  const host = new URL(fields.redirectUri).host;
  const hidden = hiddenFields(fields);
  const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="referrer" content="no-referrer" />
    <title>MCP の接続を許可</title>
  </head>
  <body>
    <h1>MCP の接続を許可</h1>
    <p><strong>${escapeHtml(client.name)}</strong> が、このアカウントでノートを読み書きします。</p>
    <p>戻る先: <code>${escapeHtml(host)}</code></p>
    <form method="POST" action="/oauth/authorize">
      ${hidden}
      <button type="submit" name="decision" value="allow">許可する</button>
      <button type="submit" name="decision" value="deny">拒否する</button>
    </form>
  </body>
</html>`;
  return new Response(html, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
    },
    status: 200,
  });
}

function hiddenFields(fields: AuthorizeFields): string {
  const entries: [string, string][] = [
    ["response_type", "code"],
    ["client_id", fields.clientId],
    ["redirect_uri", fields.redirectUri],
    ["code_challenge", fields.codeChallenge],
    ["code_challenge_method", "S256"],
    ["resource", fields.resource],
    ["scope", fields.scope],
  ];
  if (fields.state) {
    entries.push(["state", fields.state]);
  }
  return entries
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`,
    )
    .join("\n");
}

async function resolveClient(
  clientId: string,
  env: Env,
  deps: OAuthDeps,
): Promise<ResolvedClient | null> {
  if (isPublicHttpsUrl(clientId)) {
    return fetchClientMetadata(clientId, deps.fetch ?? fetch);
  }
  const row = await db(env)
    .prepare(
      "SELECT id, client_name, redirect_uris FROM oauth_clients WHERE id = ?",
    )
    .bind(clientId)
    .first<{ id: string; client_name: string | null; redirect_uris: string }>();
  if (!row) {
    return null;
  }
  const redirectUris = parseRedirectUris(row.redirect_uris);
  if (!redirectUris) {
    return null;
  }
  return {
    id: row.id,
    name: row.client_name || "MCP クライアント",
    redirectUris,
  };
}

async function fetchClientMetadata(
  clientId: string,
  fetchImpl: typeof fetch,
): Promise<ResolvedClient | null> {
  let response: Response;
  try {
    response = await fetchImpl(clientId, {
      headers: { Accept: "application/json" },
      // Workers reject redirect:"error". manual returns 3xx without following it.
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }
  const type = response.headers.get("Content-Type") ?? "";
  if (!type.startsWith("application/json")) {
    return null;
  }
  const text = await response.text();
  if (text.length > 65_536) {
    return null;
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(body) || body.client_id !== clientId) {
    return null;
  }
  const redirectUris = stringList(body.redirect_uris)?.filter(
    isAllowedRedirectUri,
  );
  if (!redirectUris || redirectUris.length === 0 || !allowsNone(body)) {
    return null;
  }
  if (!allowsCodeGrant(body)) {
    return null;
  }
  const name = typeof body.client_name === "string" ? body.client_name : "";
  return {
    id: clientId,
    name: name.trim().slice(0, 128) || "MCP クライアント",
    redirectUris,
  };
}

function allowsNone(body: Record<string, unknown>): boolean {
  const methods = stringList(body.token_endpoint_auth_methods_supported);
  const method = body.token_endpoint_auth_method;
  if (methods) {
    return methods.includes("none");
  }
  return method === undefined || method === "none";
}

function allowsCodeGrant(body: Record<string, unknown>): boolean {
  const grants = stringList(body.grant_types);
  const responses = stringList(body.response_types);
  if (grants && !grants.includes("authorization_code")) {
    return false;
  }
  return !responses || responses.includes("code");
}

function optionalName(value: unknown): string | null | false {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length > 128) {
    return false;
  }
  return trimmed || null;
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return null;
  }
  return value;
}

function parseRedirectUris(value: string): string[] | null {
  try {
    return stringList(JSON.parse(value));
  } catch {
    return null;
  }
}

function safeState(state: string): boolean {
  if (state.length > 512) {
    return false;
  }
  for (const char of state) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return false;
    }
  }
  return true;
}

function clock(deps: OAuthDeps): number {
  return deps.now ? deps.now() : Date.now();
}

/** Distinct from `now`, so a same-millisecond loser cannot satisfy EXISTS. */
function claimMarker(): number {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let value = 0;
  for (const byte of bytes) {
    value = value * 256 + byte;
  }
  return value + 1;
}

async function readForm(request: Request): Promise<URLSearchParams> {
  return new URLSearchParams(await request.text());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function redirectResponse(target: URL): Response {
  return new Response(null, {
    headers: {
      "Cache-Control": "no-store",
      Location: target.toString(),
      "Referrer-Policy": "no-referrer",
    },
    status: 302,
  });
}

function oauthJson(body: unknown, status = 200, cache = false): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": cache ? "public, max-age=300" : "no-store",
      "Content-Type": "application/json",
    },
    status,
  });
}

function oauthError(
  status: number,
  error: string,
  description: string,
): Response {
  return oauthJson({ error, error_description: description }, status);
}

function methodNotAllowed(allow: string): Response {
  return new Response("Method Not Allowed", {
    headers: { Allow: allow, "Cache-Control": "no-store" },
    status: 405,
  });
}

function preflight(allow: string): Response {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Access-Control-Allow-Methods": allow,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Max-Age": "600",
    },
    status: 204,
  });
}

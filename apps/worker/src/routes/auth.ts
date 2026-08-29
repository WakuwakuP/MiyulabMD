import {
  accessLoginUrl,
  isAccessConfigured,
  verifyAccessJwt,
} from "../auth/access.ts";
import {
  clearSessionCookieHeader,
  createSessionToken,
  readSession,
  readSessionFromToken,
  sessionCookieFromToken,
  sessionCookieHeader,
} from "../auth/session.ts";
import {
  toSessionUser,
  updateDisplayName,
  upsertUserByEmail,
} from "../db/users.ts";

function isDevAuthEnabled(env: Env): boolean {
  return env.DEV_AUTH === "true";
}

function shouldUseMockLogin(request: Request, env: Env): boolean {
  if (!isDevAuthEnabled(env)) {
    return false;
  }
  if (request.headers.get("X-Dev-User-Email")) {
    return true;
  }
  return !isAccessConfigured(env);
}

function mockEmail(request: Request): string | null {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("email");
  if (fromQuery) {
    return fromQuery;
  }
  return request.headers.get("X-Dev-User-Email");
}

function requestIsHttps(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}

function teamDomain(env: Env): string {
  return env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Access 配下の /auth/* で Set-Cookie すると、エッジが Cookie を落として
 * セッションが残らないことがある。Access の外の /api/auth/establish に渡す。
 */
async function finishLogin(
  env: Env,
  email: string,
  displayName: string | null,
): Promise<Response> {
  const user = await upsertUserByEmail(env, email, displayName);
  const token = await createSessionToken(toSessionUser(user), env);
  const html = `<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8" /><title>ログインしています</title></head>
  <body>
    <p>ログインしています…</p>
    <form id="establish" method="POST" action="/api/auth/establish">
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <noscript><button type="submit">続行</button></noscript>
    </form>
    <script>document.getElementById("establish").submit()</script>
  </body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function accessFailurePage(reason: string): Response {
  const html = `<!doctype html>
<html lang="ja">
  <head><meta charset="utf-8" /><title>ログインに失敗しました</title></head>
  <body>
    <h1>ログインに失敗しました</h1>
    <p>Cloudflare Access の認証は通りましたが、アプリセッションを発行できませんでした。</p>
    <p>理由: <code>${escapeHtml(reason)}</code></p>
    <p><a href="/auth/logout">一度ログアウトして再試行</a></p>
  </body>
</html>`;
  return new Response(html, {
    status: 401,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function logoutResponse(
  request: Request,
  env: Env,
  preferRedirect: boolean,
): Response {
  const headers = new Headers({
    "Set-Cookie": clearSessionCookieHeader(requestIsHttps(request)),
  });

  if (isAccessConfigured(env)) {
    const returnTo = new URL("/", request.url).toString();
    const logout = new URL(`https://${teamDomain(env)}/cdn-cgi/access/logout`);
    logout.searchParams.set("returnTo", returnTo);
    headers.set("Location", logout.toString());
    return new Response(null, { status: 302, headers });
  }

  if (preferRedirect) {
    headers.set("Location", "/");
    return new Response(null, { status: 302, headers });
  }

  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

/** Access 通過後の生 Request を Elysia を介さず処理する。 */
export async function handleAuthRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith("/auth/")) {
    return null;
  }

  if (pathname === "/auth/logout") {
    return logoutResponse(request, env, request.method === "GET");
  }

  if (pathname !== "/auth/login" && pathname !== "/auth/callback") {
    return new Response("Not found", { status: 404 });
  }

  const verified = await verifyAccessJwt(request, env);
  if (verified.ok) {
    return finishLogin(env, verified.claims.email, verified.claims.displayName);
  }

  if (pathname === "/auth/login" && shouldUseMockLogin(request, env)) {
    const email = mockEmail(request);
    if (!email) {
      return new Response(
        "email query parameter or X-Dev-User-Email header is required",
        {
          status: 400,
        },
      );
    }
    return finishLogin(env, email, email.split("@")[0] ?? null);
  }

  if (isAccessConfigured(env)) {
    console.warn("access login skipped", verified.reason);
    if (verified.reason !== "missing_jwt" || pathname === "/auth/callback") {
      return accessFailurePage(verified.reason);
    }
    return new Response(null, {
      status: 302,
      headers: { Location: accessLoginUrl(request, env) },
    });
  }

  return new Response("Cloudflare Access is not configured", { status: 503 });
}

export async function handleUpdateMe(
  request: Request,
  env: Env,
): Promise<Response> {
  const session = await readSession(request, env);
  if (!session) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  let displayName: string | null = null;
  try {
    const body = (await request.json()) as { displayName?: unknown };
    if (typeof body.displayName === "string") {
      displayName = body.displayName;
    } else if (body.displayName !== null && body.displayName !== undefined) {
      return new Response(
        JSON.stringify({ error: "displayName must be a string" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const updated = await updateDisplayName(env, session.id, displayName);
  if (!updated) {
    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const user = toSessionUser(updated);
  const setCookie = await sessionCookieHeader(
    user,
    env,
    requestIsHttps(request),
  );
  return new Response(JSON.stringify({ user }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": setCookie,
    },
  });
}

/** Access の外でセッション Cookie を付ける。 */
export async function handleEstablishSession(
  request: Request,
  env: Env,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  const contentType = request.headers.get("Content-Type") ?? "";
  let token: string | null = null;
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    const value = form.get("token");
    token = typeof value === "string" ? value : null;
  } else {
    const text = await request.text();
    token = new URLSearchParams(text).get("token");
  }

  if (!token) {
    return new Response("Missing session token", { status: 400 });
  }

  const user = await readSessionFromToken(token, env);
  if (!user) {
    return new Response("Invalid session token", { status: 401 });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: "/",
      "Set-Cookie": sessionCookieFromToken(token, requestIsHttps(request)),
      "Cache-Control": "no-store",
    },
  });
}

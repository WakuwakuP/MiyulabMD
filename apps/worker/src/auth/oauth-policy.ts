/** Scope granted to an MCP OAuth client: the signed-in user's notes. */
export const MCP_SCOPE = "mcp";

const VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
const OAUTH_NEXT_COOKIE = "miyulabmd_oauth_next";

export function mcpResource(origin: string): string {
  return `${origin}/mcp`;
}

export function protectedResourceMetadata(origin: string) {
  return {
    authorization_servers: [origin],
    bearer_methods_supported: ["header"],
    resource: mcpResource(origin),
    resource_documentation: `${origin}/settings/mcp`,
    scopes_supported: [MCP_SCOPE],
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    authorization_endpoint: `${origin}/oauth/authorize`,
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    code_challenge_methods_supported: ["S256"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    issuer: origin,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    scopes_supported: [MCP_SCOPE],
    token_endpoint: `${origin}/oauth/token`,
    token_endpoint_auth_methods_supported: ["none"],
  };
}

export function wwwAuthenticate(origin: string, invalidToken: boolean): string {
  const metadata = `${origin}/.well-known/oauth-protected-resource/mcp`;
  const parts = [`Bearer realm="mcp"`];
  if (invalidToken) {
    parts.push(`error="invalid_token"`);
  }
  parts.push(`resource_metadata="${metadata}"`, `scope="${MCP_SCOPE}"`);
  return parts.join(", ");
}

export function normalizeScope(raw: string | null): string | null {
  if (raw === null || raw.trim() === "") {
    return MCP_SCOPE;
  }
  const scopes = raw.split(/\s+/).filter(Boolean);
  if (scopes.length === 0 || scopes.some((scope) => scope !== MCP_SCOPE)) {
    return null;
  }
  return MCP_SCOPE;
}

export function isPublicHttpsUrl(value: string): boolean {
  const url = parseUrl(value);
  return Boolean(
    url &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !isBlockedHost(url.hostname),
  );
}

export function isAllowedRedirectUri(value: string): boolean {
  const url = parseUrl(value);
  if (!url || url.username || url.password || url.hash) {
    return false;
  }
  if (url.protocol === "https:") {
    return !isBlockedHost(url.hostname);
  }
  return url.protocol === "http:" && isLoopback(url.hostname);
}

/** Exact match, except loopback ports (RFC 8252). */
function redirectMatches(registered: string, requested: string): boolean {
  const expected = parseUrl(registered);
  const actual = parseUrl(requested);
  if (!(expected && actual)) {
    return false;
  }
  if (
    expected.protocol === "http:" &&
    actual.protocol === "http:" &&
    isLoopback(expected.hostname) &&
    expected.hostname === actual.hostname
  ) {
    return (
      expected.pathname === actual.pathname && expected.search === actual.search
    );
  }
  return registered === requested;
}

export function redirectListed(
  registered: string[],
  requested: string,
): boolean {
  return registered.some((item) => redirectMatches(item, requested));
}

export function validCodeVerifier(verifier: string): boolean {
  return VERIFIER_PATTERN.test(verifier);
}

export async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64Url(new Uint8Array(digest));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function randomToken(prefix: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `${prefix}${base64Url(bytes)}`;
}

/** Same-origin return path after login. Only the OAuth consent URL. */
export function safeOAuthReturnPath(value: string | null): string | null {
  if (!value || value.length > 3500 || !value.startsWith("/oauth/authorize?")) {
    return null;
  }
  if (value.includes("\\") || value.includes("//") || value.includes("\0")) {
    return null;
  }
  const url = parseUrl(value, "https://oauth.invalid");
  if (url?.origin !== "https://oauth.invalid") {
    return null;
  }
  if (url.pathname !== "/oauth/authorize") {
    return null;
  }
  return `${url.pathname}${url.search}`;
}

export function oauthNextCookie(path: string, secure: boolean): string {
  return `${OAUTH_NEXT_COOKIE}=${encodeURIComponent(path)}; ${cookieFlags(secure)}; Max-Age=600`;
}

export function clearOAuthNextCookie(secure: boolean): string {
  return `${OAUTH_NEXT_COOKIE}=; ${cookieFlags(secure)}; Max-Age=0`;
}

export function readOAuthNext(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey !== OAUTH_NEXT_COOKIE) {
      continue;
    }
    try {
      return safeOAuthReturnPath(decodeURIComponent(rest.join("=")));
    } catch {
      return null;
    }
  }
  return null;
}

function cookieFlags(secure: boolean): string {
  const parts = ["HttpOnly", "SameSite=Lax", "Path=/"];
  if (secure) {
    parts.splice(1, 0, "Secure");
  }
  return parts.join("; ");
}

function parseUrl(value: string, base?: string): URL | null {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "169.254.169.254"
  ) {
    return true;
  }
  const match = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!match) {
    return false;
  }
  const a = Number(match[1]);
  const b = Number(match[2]);
  if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)) {
    return true;
  }
  if ((a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) {
    return true;
  }
  return a === 100 && b >= 64 && b <= 127;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

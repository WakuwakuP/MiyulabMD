import type { SessionUser } from "@miyulabmd/shared";

import { db } from "../db/client.ts";

export type ApiTokenSummary = {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export type ApiTokenCreated = ApiTokenSummary & {
  token: string;
};

type TokenUserRow = {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
};

function rowToSummary(row: {
  id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}): ApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

/** SHA-256 hex digest of the plaintext token. */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function generatePlainToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `mlb_${random}`;
}

/** Personal Access Token (Bearer) を SHA-256 照合する。MCP / 自動化用。 */
export async function authenticateBearer(
  request: Request,
  env: Env,
): Promise<SessionUser | null> {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  const plaintext = header.slice("Bearer ".length).trim();
  if (!plaintext) {
    return null;
  }

  const tokenHash = await hashToken(plaintext);
  const row = await db(env)
    .prepare(
      `SELECT t.id, t.user_id, u.email, u.display_name
       FROM api_tokens t
       INNER JOIN users u ON u.id = t.user_id
       WHERE t.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<TokenUserRow>();

  if (!row) {
    return null;
  }

  await db(env)
    .prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?")
    .bind(Date.now(), row.id)
    .run();

  return {
    id: row.user_id,
    email: row.email,
    displayName: row.display_name,
  };
}

export async function listTokensForUser(env: Env, userId: string): Promise<ApiTokenSummary[]> {
  const rows = await db(env)
    .prepare(
      `SELECT id, name, created_at, last_used_at
       FROM api_tokens
       WHERE user_id = ?
       ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<{
      id: string;
      name: string;
      created_at: number;
      last_used_at: number | null;
    }>();

  return (rows.results ?? []).map(rowToSummary);
}

export async function createTokenForUser(
  env: Env,
  userId: string,
  name: string,
): Promise<ApiTokenCreated | { error: string }> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    return { error: "name is required" };
  }

  const plaintext = generatePlainToken();
  const tokenHash = await hashToken(plaintext);
  const id = crypto.randomUUID();
  const now = Date.now();

  await db(env)
    .prepare(
      `INSERT INTO api_tokens (id, user_id, name, token_hash, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .bind(id, userId, trimmedName, tokenHash, now)
    .run();

  return {
    id,
    name: trimmedName,
    createdAt: now,
    lastUsedAt: null,
    token: plaintext,
  };
}

export async function revokeTokenForUser(
  env: Env,
  userId: string,
  tokenId: string,
): Promise<"ok" | "not_found"> {
  const result = await db(env)
    .prepare("DELETE FROM api_tokens WHERE id = ? AND user_id = ?")
    .bind(tokenId, userId)
    .run();

  return result.meta.changes > 0 ? "ok" : "not_found";
}

import type { SessionUser } from "@miyulabmd/shared";

import { createNoteService } from "../services/notes.ts";

const CATALOG_USER_HEADER = "x-catalog-user";
const CATALOG_GUEST_NAME = "guest";

export type CatalogListQuery = {
  folderId?: string;
  query?: string;
  recursive?: boolean;
};

export function catalogObjectName(user: SessionUser | null): string {
  return user?.id ?? CATALOG_GUEST_NAME;
}

export function catalogListRequest(
  user: SessionUser | null,
  query?: CatalogListQuery,
): Request {
  const headers = new Headers();
  if (user) {
    headers.set(
      CATALOG_USER_HEADER,
      JSON.stringify({
        email: user.email,
        id: user.id,
      }),
    );
  }
  if (!query) {
    return new Request("https://catalog.internal/list", { headers });
  }
  headers.set("content-type", "application/json");
  return new Request("https://catalog.internal/list", {
    body: JSON.stringify(query),
    headers,
    method: "POST",
  });
}

function readCatalogUser(request: Request): SessionUser | null | "invalid" {
  const raw = request.headers.get(CATALOG_USER_HEADER);
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return "invalid";
  }
  if (!parsed || typeof parsed !== "object") {
    return "invalid";
  }
  const candidate = parsed as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.email !== "string") {
    return "invalid";
  }
  return {
    displayName:
      typeof candidate.displayName === "string" ? candidate.displayName : null,
    email: candidate.email,
    id: candidate.id,
  };
}

function readListQuery(value: unknown): CatalogListQuery | "invalid" {
  if (!value || typeof value !== "object") {
    return "invalid";
  }
  const body = value as Record<string, unknown>;
  if (body.folderId !== undefined && typeof body.folderId !== "string") {
    return "invalid";
  }
  if (body.query !== undefined && typeof body.query !== "string") {
    return "invalid";
  }
  if (body.recursive !== undefined && typeof body.recursive !== "boolean") {
    return "invalid";
  }
  return {
    folderId: typeof body.folderId === "string" ? body.folderId : undefined,
    query: typeof body.query === "string" ? body.query : undefined,
    recursive: body.recursive === true,
  };
}

async function listForCatalog(
  env: Env,
  user: SessionUser,
  query: CatalogListQuery,
): Promise<{ notes: unknown[] } | { error: string }> {
  const notes = createNoteService(env);
  let list: Awaited<ReturnType<typeof notes.listForUser>>;
  if (query.folderId) {
    const result = await notes.listFolderNotes(
      user,
      query.folderId,
      query.recursive ?? false,
    );
    if (result.kind === "not_found") {
      return { error: "Not found" };
    }
    if (result.kind === "denied") {
      return { error: result.status === 401 ? "Unauthorized" : "Forbidden" };
    }
    list = result.notes;
  } else {
    list = await notes.listForUser(user);
  }
  const trimmedQuery = query.query?.trim();
  if (trimmedQuery) {
    const needle = trimmedQuery.toLowerCase();
    list = list.filter((note) => note.title.toLowerCase().includes(needle));
  }
  return { notes: list };
}

function catalogErrorStatus(error: string): number {
  switch (error) {
    case "Unauthorized":
      return 401;
    case "Forbidden":
      return 403;
    case "Not found":
      return 404;
    default:
      return 400;
  }
}

async function listResponse(
  env: Env,
  user: SessionUser | null,
): Promise<Response> {
  const notes = createNoteService(env);
  const list = user
    ? await notes.listForUser(user)
    : await notes.listForGuest();
  return Response.json({ notes: list });
}

async function readPostedQuery(
  request: Request,
): Promise<CatalogListQuery | Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  const query = readListQuery(body);
  if (query === "invalid") {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }
  return query;
}

/** 入口が付けたユーザーヘッダだけで一覧する。セッションは再検証しない。 */
export async function handleCatalogList(
  env: Env,
  request: Request,
): Promise<Response> {
  const user = readCatalogUser(request);
  if (user === "invalid") {
    return Response.json({ error: "invalid user" }, { status: 400 });
  }
  if (request.method === "GET") {
    return listResponse(env, user);
  }
  if (request.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const query = await readPostedQuery(request);
  if (query instanceof Response) {
    return query;
  }
  const result = await listForCatalog(env, user, query);
  if ("error" in result) {
    return Response.json(
      { error: result.error },
      { status: catalogErrorStatus(result.error) },
    );
  }
  return Response.json({ notes: result.notes });
}

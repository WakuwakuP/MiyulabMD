import {
  isSearchScope,
  layerFilterValue,
  type WorkspaceSearchResult,
} from "@miyulabmd/shared";

import { ensureFolderRow, listOwnedFolders } from "../services/access.ts";
import { createNoteService } from "../services/notes.ts";
import { folderIdsForSchemeId } from "../services/schemes.ts";
import { GREP_LIMITS } from "../services/search.ts";
import { readCatalogUser } from "./catalog-list.ts";

type CatalogActor = ReturnType<typeof readCatalogUser>;

function emptyResult(query: string): WorkspaceSearchResult {
  return {
    grep: { matches: [], scannedNotes: 0, truncated: false },
    notes: [],
    query,
  };
}

function intParam(url: URL, name: string, fallback: number, max: number) {
  const raw = url.searchParams.get(name);
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(Math.trunc(value), max));
}

async function folderIdParam(
  env: Env,
  url: URL,
  userId: string | undefined,
): Promise<{ folderIds?: string[]; notFound?: boolean }> {
  const schemeId = url.searchParams.get("schemeId");
  if (!schemeId) {
    const folderId = url.searchParams.get("folderId");
    return { folderIds: folderId ? [folderId] : undefined };
  }
  if (!userId) {
    return { notFound: true };
  }
  const folderIds = await folderIdsForSchemeId(env, userId, schemeId);
  return folderIds.length > 0 ? { folderIds } : { notFound: true };
}

async function searchWorkspace(
  env: Env,
  request: Request,
  user: CatalogActor,
): Promise<Response> {
  if (user === "invalid") {
    return Response.json({ error: "invalid user" }, { status: 400 });
  }
  const url = new URL(request.url);
  const query = (
    url.searchParams.get("query") ??
    url.searchParams.get("q") ??
    ""
  ).trim();
  if (!query) {
    return Response.json(emptyResult(query));
  }
  const context = intParam(url, "context", 1, GREP_LIMITS.maxContext);
  const notes = createNoteService(env);
  return Response.json(
    await notes.searchWorkspace(user ?? undefined, query, {
      contextAfter: context,
      contextBefore: context,
    }),
  );
}

async function searchNotePage(
  env: Env,
  request: Request,
  user: CatalogActor,
): Promise<Response> {
  if (user === "invalid") {
    return Response.json({ error: "invalid user" }, { status: 400 });
  }
  const url = new URL(request.url);
  const query = (url.searchParams.get("query") ?? "").trim();
  if (!query) {
    return Response.json({ error: "query is required" }, { status: 400 });
  }
  const scopeParam = url.searchParams.get("scope");
  const scope =
    scopeParam && isSearchScope(scopeParam) ? scopeParam : undefined;
  const layerParam = url.searchParams.get("layer");
  const layer =
    layerParam && layerFilterValue(layerParam) ? layerParam : undefined;
  const target = await folderIdParam(env, url, user?.id);
  if (target.notFound) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const notes = createNoteService(env);
  const result = await notes.searchNotes(user ?? undefined, {
    cursor: url.searchParams.get("cursor") ?? undefined,
    folderIds: target.folderIds,
    layer,
    limit: intParam(url, "limit", 50, 200),
    query,
    scope,
  });
  if (result.kind === "not_found") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({
    nextCursor: result.nextCursor,
    notes: result.notes,
    query,
  });
}

async function searchGrep(
  env: Env,
  request: Request,
  user: CatalogActor,
): Promise<Response> {
  if (user === "invalid") {
    return Response.json({ error: "invalid user" }, { status: 400 });
  }
  const url = new URL(request.url);
  const target = await folderIdParam(env, url, user?.id);
  if (target.notFound) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const notes = createNoteService(env);
  const result = await notes.grep(user ?? undefined, {
    caseSensitive: url.searchParams.get("caseSensitive") === "true",
    contextAfter: intParam(url, "contextAfter", 1, GREP_LIMITS.maxContext),
    contextBefore: intParam(url, "contextBefore", 1, GREP_LIMITS.maxContext),
    fixedString: url.searchParams.get("fixedString") !== "false",
    folderIds: target.folderIds,
    globTitle: url.searchParams.get("globTitle") ?? undefined,
    maxMatchesPerNote: intParam(
      url,
      "maxMatchesPerNote",
      10,
      GREP_LIMITS.maxMatchesPerNote,
    ),
    maxNotes: intParam(url, "maxNotes", 50, GREP_LIMITS.maxNotes),
    pattern: url.searchParams.get("pattern") ?? "",
  });
  if (result.kind === "not_found") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (result.kind === "bad_request") {
    return Response.json({ error: result.error }, { status: 400 });
  }
  const { kind: _kind, ...grep } = result;
  return Response.json(grep);
}

export async function handleCatalogSearch(
  env: Env,
  request: Request,
): Promise<Response> {
  const user = readCatalogUser(request);
  const path = new URL(request.url).pathname;
  if (path.endsWith("/notes")) {
    return await searchNotePage(env, request, user);
  }
  if (path.endsWith("/grep")) {
    return await searchGrep(env, request, user);
  }
  return await searchWorkspace(env, request, user);
}

export async function handleCatalogTree(
  env: Env,
  request: Request,
): Promise<Response> {
  const user = readCatalogUser(request);
  if (user === "invalid") {
    return Response.json({ error: "invalid user" }, { status: 400 });
  }
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureFolderRow(env, user.id, "");
  return Response.json({ folders: await listOwnedFolders(env, user.id) });
}

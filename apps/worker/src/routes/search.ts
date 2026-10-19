import { env } from "cloudflare:workers";
import type { WorkspaceSearchResult } from "@miyulabmd/shared";
import { Elysia } from "elysia";

import { readSession } from "../auth/session.ts";
import {
  catalogQueryName,
  catalogReadRequest,
} from "../durable-objects/catalog-list.ts";

function emptyResult(query: string): WorkspaceSearchResult {
  return {
    grep: { matches: [], scannedNotes: 0, truncated: false },
    notes: [],
    query,
  };
}

function forwardSearch(
  request: Request,
  user: Parameters<typeof catalogReadRequest>[0],
  path: string,
) {
  const id = env.CATALOG.idFromName(catalogQueryName(user));
  return env.CATALOG.get(id).fetch(catalogReadRequest(user, request, path));
}

export const searchRoutes = new Elysia({ prefix: "/api/search" })
  .get("/", async ({ request }) => {
    const user = await readSession(request, env);
    const url = new URL(request.url);
    const query = (
      url.searchParams.get("query") ??
      url.searchParams.get("q") ??
      ""
    ).trim();
    if (!query) {
      return emptyResult(query);
    }
    return forwardSearch(request, user, "/search");
  })
  .get("/notes", async ({ request }) => {
    const user = await readSession(request, env);
    const query = new URL(request.url).searchParams.get("query")?.trim() ?? "";
    if (!query) {
      return new Response(JSON.stringify({ error: "query is required" }), {
        headers: { "content-type": "application/json" },
        status: 400,
      });
    }
    return forwardSearch(request, user, "/search/notes");
  })
  .get("/grep", async ({ request }) => {
    const user = await readSession(request, env);
    return forwardSearch(request, user, "/search/grep");
  });

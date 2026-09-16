import { env } from "cloudflare:workers";
import { isSearchScope, type WorkspaceSearchResult } from "@miyulabmd/shared";
import { Elysia } from "elysia";

import { readSession } from "../auth/session.ts";
import { createNoteService } from "../services/notes.ts";
import { GREP_LIMITS } from "../services/search.ts";

const notes = createNoteService(env);

type RouteSet = { status?: number | string };

function emptyResult(query: string): WorkspaceSearchResult {
  return {
    grep: { matches: [], scannedNotes: 0, truncated: false },
    notes: [],
    query,
  };
}

function intParam(
  url: URL,
  name: string,
  fallback: number,
  max: number,
): number {
  const raw = url.searchParams.get(name);
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.min(Math.trunc(value), max));
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
    const context = intParam(url, "context", 1, GREP_LIMITS.maxContext);
    return notes.searchWorkspace(user ?? undefined, query, {
      contextAfter: context,
      contextBefore: context,
    });
  })
  .get(
    "/notes",
    async ({ request, set }: { request: Request; set: RouteSet }) => {
      const user = await readSession(request, env);
      const url = new URL(request.url);
      const query = (url.searchParams.get("query") ?? "").trim();
      if (!query) {
        set.status = 400;
        return { error: "query is required" };
      }
      const scopeParam = url.searchParams.get("scope");
      const scope =
        scopeParam && isSearchScope(scopeParam) ? scopeParam : undefined;
      const result = await notes.searchNotes(user ?? undefined, {
        cursor: url.searchParams.get("cursor") ?? undefined,
        folderId: url.searchParams.get("folderId") ?? undefined,
        limit: intParam(url, "limit", 50, 200),
        query,
        scope,
      });
      if (result.kind === "not_found") {
        set.status = 404;
        return { error: "Not found" };
      }
      return { nextCursor: result.nextCursor, notes: result.notes, query };
    },
  )
  .get(
    "/grep",
    async ({ request, set }: { request: Request; set: RouteSet }) => {
      const user = await readSession(request, env);
      const url = new URL(request.url);
      const pattern = url.searchParams.get("pattern") ?? "";
      const result = await notes.grep(user ?? undefined, {
        caseSensitive: url.searchParams.get("caseSensitive") === "true",
        contextAfter: intParam(url, "contextAfter", 1, GREP_LIMITS.maxContext),
        contextBefore: intParam(
          url,
          "contextBefore",
          1,
          GREP_LIMITS.maxContext,
        ),
        fixedString: url.searchParams.get("fixedString") !== "false",
        folderId: url.searchParams.get("folderId") ?? undefined,
        globTitle: url.searchParams.get("globTitle") ?? undefined,
        maxMatchesPerNote: intParam(
          url,
          "maxMatchesPerNote",
          10,
          GREP_LIMITS.maxMatchesPerNote,
        ),
        maxNotes: intParam(url, "maxNotes", 50, GREP_LIMITS.maxNotes),
        pattern,
      });
      if (result.kind === "not_found") {
        set.status = 404;
        return { error: "Not found" };
      }
      if (result.kind === "bad_request") {
        set.status = 400;
        return { error: result.error };
      }
      const { kind: _kind, ...grep } = result;
      return grep;
    },
  );

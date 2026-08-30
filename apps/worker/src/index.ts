import { env } from "cloudflare:workers";
import { collectOgUrls, renderMarkdownHtml } from "@miyulabmd/markdown";
import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { isAccessConfigured } from "./auth/access.ts";
import { readSession } from "./auth/session.ts";
import { mcpRoutes } from "./mcp/routes.ts";
import {
  handleAuthRequest,
  handleEstablishSession,
  handleUpdateMe,
} from "./routes/auth.ts";
import { folderRoutes } from "./routes/folders.ts";
import { imageRoutes } from "./routes/images.ts";
import { noteRoutes } from "./routes/notes.ts";
import { ogRoutes } from "./routes/og.ts";
import { tokenRoutes } from "./routes/tokens.ts";
import { createNoteService } from "./services/notes.ts";
import { peekOgCards, warmOgCards } from "./services/og.ts";
import {
  injectNotePage,
  isPublicGuestCacheable,
  notePageId,
} from "./ssr/inject-note-page.ts";

export { DocumentRoom } from "./durable-objects/DocumentRoom.ts";

const api = new Elysia({ adapter: CloudflareAdapter })
  .get("/api/health", () => ({ ok: true }))
  .get("/api/me", async ({ request }) => {
    const user = await readSession(request, env);
    return { user };
  })
  .get("/api/auth/config", () => {
    const access = isAccessConfigured(env);
    return {
      access,
      mock: env.DEV_AUTH === "true" && !access,
    };
  })
  .use(noteRoutes)
  .use(folderRoutes)
  .use(ogRoutes)
  .use(tokenRoutes)
  .use(imageRoutes)
  .use(mcpRoutes)
  .compile();

function noteIdFromWsPath(pathname: string): string | null {
  const match = /^\/ws\/notes\/([^/]+)$/.exec(pathname);
  return match?.[1] ?? null;
}

function isElysiaPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/")
  );
}

function notePageCacheKey(url: URL): Request {
  return new Request(`${url.origin}${url.pathname}`, { method: "GET" });
}

async function handleNotePage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const id = notePageId(url.pathname);
  if (!id || (request.method !== "GET" && request.method !== "HEAD")) {
    return env.ASSETS.fetch(request);
  }

  const user = await readSession(request, env);
  const cacheable = !user;
  if (cacheable) {
    const cached = await caches.default.match(notePageCacheKey(url));
    if (cached) return cached;
  }

  const notes = createNoteService(env);
  const [result, assets] = await Promise.all([
    notes.get(id, user ?? undefined),
    env.ASSETS.fetch(request),
  ]);

  if (result.kind !== "ok") {
    return assets;
  }

  const indexHtml = await assets.text();
  const ogUrls = collectOgUrls(result.note.markdown);
  const ogCards = await peekOgCards(url.origin, ogUrls);
  const missingOg = ogUrls.filter((href) => !ogCards.has(href));
  if (missingOg.length > 0) {
    ctx.waitUntil(warmOgCards(url.origin, missingOg, env.OG_FETCH));
  }
  const previewHtml = renderMarkdownHtml(result.note.markdown, ogCards);
  const ogRecord = Object.fromEntries(ogCards);
  const body = injectNotePage(indexHtml, result.note, previewHtml, ogRecord);
  const publicCache =
    isPublicGuestCacheable(result.note, Boolean(user)) &&
    missingOg.length === 0;
  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": publicCache ? "public, s-maxage=30" : "private, no-store",
  });

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }

  const response = new Response(body, { status: 200, headers });
  if (publicCache) {
    ctx.waitUntil(caches.default.put(notePageCacheKey(url), response.clone()));
  }
  return response;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (notePageId(pathname)) {
      return handleNotePage(request, env, ctx);
    }

    const noteId = noteIdFromWsPath(pathname);
    if (noteId) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected WebSocket upgrade", {
          status: 426,
          headers: { Upgrade: "websocket" },
        });
      }

      const user = await readSession(request, env);
      const notes = createNoteService(env);
      const result = await notes.get(noteId, user ?? undefined);

      if (result.kind === "not_found") {
        return new Response("Not found", { status: 404 });
      }
      if (result.kind === "denied") {
        return new Response(
          result.status === 401 ? "Unauthorized" : "Forbidden",
          {
            status: result.status,
          },
        );
      }

      const note = result.note;

      const id = env.DOCUMENT_ROOM.idFromName(note.id);
      const headers = new Headers(request.headers);
      headers.set("X-Note-Id", note.id);
      headers.set("X-Can-Edit", note.access.flags.canEdit ? "true" : "false");
      if (user) {
        headers.set("X-User-Id", user.id);
        if (user.displayName) {
          headers.set("X-Display-Name", user.displayName);
        }
      }

      const doRequest = new Request(request.url, {
        headers,
        method: request.method,
      });
      return env.DOCUMENT_ROOM.get(id).fetch(doRequest);
    }

    if (pathname === "/api/auth/establish") {
      return handleEstablishSession(request, env);
    }

    if (pathname === "/api/me" && request.method === "PATCH") {
      return handleUpdateMe(request, env);
    }

    if (pathname.startsWith("/auth/")) {
      const authResponse = await handleAuthRequest(request, env);
      if (authResponse) {
        return authResponse;
      }
    }

    if (isElysiaPath(pathname)) {
      return api.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

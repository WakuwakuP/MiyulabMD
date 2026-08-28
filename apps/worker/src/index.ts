import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { mcpRoutes } from "./mcp/routes.ts";
import { authRoutes } from "./routes/auth.ts";
import { imageRoutes } from "./routes/images.ts";
import { noteRoutes } from "./routes/notes.ts";

export { DocumentRoom } from "./durable-objects/DocumentRoom.ts";

const api = new Elysia({ adapter: CloudflareAdapter })
  .get("/api/health", () => ({ ok: true }))
  .get("/api/me", () => ({ user: null }))
  .use(authRoutes)
  .use(noteRoutes)
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
    pathname.startsWith("/auth/") ||
    pathname === "/mcp" ||
    pathname.startsWith("/mcp/")
  );
}

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);

    const noteId = noteIdFromWsPath(pathname);
    if (noteId) {
      const id = env.DOCUMENT_ROOM.idFromName(noteId);
      return env.DOCUMENT_ROOM.get(id).fetch(request);
    }

    if (isElysiaPath(pathname)) {
      return api.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};

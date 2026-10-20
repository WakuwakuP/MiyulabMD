import { env } from "cloudflare:workers";
import { Elysia } from "elysia";

import { readSession } from "../auth/session.ts";
import { ensureFolderRow } from "../services/access.ts";
import {
  type ArticleSourceWrite,
  createArticleService,
} from "../services/articles.ts";
import {
  canEditSubject,
  driveRoleFor,
  isSharedDrive,
} from "../services/drive-membership.ts";
import { moveFolder } from "../services/move.ts";

const articles = createArticleService(env);

async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export const articleSourceRoutes = new Elysia({
  prefix: "/api/article-sources",
})
  .get("/", async ({ request, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const url = new URL(request.url);
    const ownerId = url.searchParams.get("ownerId") ?? user.id;
    if (ownerId !== user.id) {
      const role = (await isSharedDrive(env, ownerId))
        ? await driveRoleFor(env, ownerId, user)
        : null;
      const allowed =
        role === "manager" ||
        role === "editor" ||
        (role === null && (await canEditSubject(env, ownerId, user)));
      if (!allowed) {
        set.status = 403;
        return { error: "Forbidden" };
      }
    }
    const sources = await articles.listSources(ownerId, user);
    if (url.searchParams.get("shared") === "1" && ownerId === user.id) {
      return {
        sharedSources: await articles.listEditableSharedSources(user),
        sources,
      };
    }
    return { sources };
  })
  .get("/status", async ({ request, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    return articles.status(user.id);
  })
  .get("/dispatch-target", async ({ request, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const params = new URL(request.url).searchParams;
    const folderId = params.get("folderId")?.trim() ?? "";
    const noteId = params.get("noteId")?.trim() ?? "";
    const target =
      folderId || noteId
        ? await articles.dispatchTarget(user, {
            ...(folderId ? { folderId } : { noteId }),
          })
        : null;
    return { target };
  })
  .post("/", async ({ request, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const body = await parseJsonBody<ArticleSourceWrite & { ownerId?: string }>(
      request,
    );
    const ownerId = body?.ownerId ?? user.id;
    if (ownerId !== user.id) {
      const allowed = (await isSharedDrive(env, ownerId))
        ? (await driveRoleFor(env, ownerId, user)) === "manager"
        : await canEditSubject(env, ownerId, user);
      if (!allowed) {
        set.status = 403;
        return { error: "Forbidden" };
      }
    }
    const created = await articles.createSource(user, ownerId, body ?? {});
    if ("error" in created) {
      set.status = created.status;
      return { error: created.error };
    }
    set.status = 201;
    return created;
  })
  .post("/:id/migrate", async ({ request, params, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const body = await parseJsonBody<{
      destFolderId?: string;
      dryRun?: boolean;
    }>(request);
    const destFolderId = body?.destFolderId?.trim() ?? "";
    if (!destFolderId) {
      set.status = 400;
      return { error: "destFolderId が必要です" };
    }
    const row = await articles.getSource(user.id, params.id);
    if (row?.ownerKind !== "user") {
      set.status = 404;
      return { error: "Not found" };
    }
    const folderId =
      row.folderId ?? (await ensureFolderRow(env, user.id, row.folder));
    if (!folderId) {
      set.status = 400;
      return { error: "フォルダが見つかりません" };
    }
    const moved = await moveFolder(
      env,
      folderId,
      { destFolderId, dryRun: body?.dryRun ?? false },
      user,
    );
    if (moved.kind === "not_found") {
      set.status = 404;
      return { error: "Not found" };
    }
    if (moved.kind === "denied") {
      set.status = moved.status;
      return { error: "Forbidden" };
    }
    if (moved.kind === "invalid") {
      set.status = moved.status;
      return { error: moved.error };
    }
    return moved.result;
  })
  .post("/:id/dispatch", async ({ request, params, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const result = await articles.dispatch(user, params.id);
    if (!result) {
      set.status = 404;
      return { error: "Not found" };
    }
    if ("error" in result) {
      set.status = result.status;
      return { error: result.error };
    }
    return { ok: true };
  })
  .patch("/:id", async ({ request, params, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const body = await parseJsonBody<ArticleSourceWrite>(request);
    if (!body) {
      set.status = 400;
      return { error: "Invalid JSON body" };
    }
    const updated = await articles.updateSource(user, params.id, body);
    if (!updated) {
      set.status = 404;
      return { error: "Not found" };
    }
    if ("error" in updated) {
      set.status = updated.status;
      return { error: updated.error };
    }
    return updated;
  })
  .delete("/:id", async ({ request, params, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const deleted = await articles.deleteSource(user, params.id);
    if (!deleted) {
      set.status = 404;
      return { error: "Not found" };
    }
    set.status = 204;
    return new Response(null, { status: 204 });
  });

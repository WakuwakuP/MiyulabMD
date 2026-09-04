import { env } from "cloudflare:workers";
import { Elysia } from "elysia";

import { readSession } from "../auth/session.ts";
import {
  type ArticleSourceWrite,
  createArticleService,
} from "../services/articles.ts";

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
    const sources = await articles.listSources(user.id);
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
  .post("/", async ({ request, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const body = await parseJsonBody<ArticleSourceWrite>(request);
    const created = await articles.createSource(user.id, body ?? {});
    if ("error" in created) {
      set.status = created.status;
      return { error: created.error };
    }
    set.status = 201;
    return created;
  })
  .post("/:id/dispatch", async ({ request, params, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const result = await articles.dispatch(user.id, params.id);
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
    const updated = await articles.updateSource(user.id, params.id, body);
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
    const deleted = await articles.deleteSource(user.id, params.id);
    if (!deleted) {
      set.status = 404;
      return { error: "Not found" };
    }
    set.status = 204;
    return new Response(null, { status: 204 });
  });

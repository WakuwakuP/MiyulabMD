import { env } from "cloudflare:workers";
import { parseArticleListQuery } from "@miyulabmd/shared";
import { Elysia } from "elysia";

import { authenticateBearer } from "../auth/tokens.ts";
import { createArticleService } from "../services/articles.ts";

const articles = createArticleService(env);

export const articleRoutes = new Elysia({ prefix: "/api/articles" })
  .get("/collections", async ({ request, set }) => {
    const user = await authenticateBearer(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const collections = await articles.listCollections(user.id);
    return { collections };
  })
  .get("/collections/:id/entries", async ({ request, params, set }) => {
    const user = await authenticateBearer(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const url = new URL(request.url);
    const query = parseArticleListQuery(url.searchParams);
    if ("error" in query) {
      set.status = 400;
      return { error: query.error };
    }
    const result = await articles.listEntries(
      user.id,
      params.id,
      url.origin,
      query,
    );
    if (!result) {
      set.status = 404;
      return { error: "Not found" };
    }
    if ("error" in result) {
      set.status = result.status;
      return { error: result.error };
    }
    return result;
  })
  .get("/collections/:id/entries/:slug", async ({ request, params, set }) => {
    const user = await authenticateBearer(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const origin = new URL(request.url).origin;
    const result = await articles.getEntry(
      user.id,
      params.id,
      params.slug,
      origin,
    );
    if (!result) {
      set.status = 404;
      return { error: "Not found" };
    }
    return result;
  });

import { Elysia } from "elysia";

import { loadOgPreview, OG_CACHE_CONTROL } from "../services/og.ts";

export const ogRoutes = new Elysia({ prefix: "/api/og" }).get(
  "/",
  async ({ request, set }) => {
    const requestUrl = new URL(request.url);
    const url = requestUrl.searchParams.get("url") ?? "";
    const result = await loadOgPreview(requestUrl.origin, url);
    if ("error" in result) {
      set.status = result.status;
      return { error: result.error };
    }
    set.headers["Cache-Control"] = OG_CACHE_CONTROL;
    return result;
  },
);

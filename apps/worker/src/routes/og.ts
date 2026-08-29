import { Elysia } from "elysia";

import { fetchOgPreview } from "../services/og.ts";

export const ogRoutes = new Elysia({ prefix: "/api/og" }).get(
  "/",
  async ({ request, set }) => {
    const url = new URL(request.url).searchParams.get("url") ?? "";
    const result = await fetchOgPreview(url);
    if ("error" in result) {
      set.status = result.status;
      return { error: result.error };
    }
    return result;
  },
);

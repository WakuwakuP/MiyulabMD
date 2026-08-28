import { env } from "cloudflare:workers";
import { Elysia } from "elysia";

import { readSession } from "../auth/session.ts";
import { fetchOgPreview } from "../services/og.ts";

export const ogRoutes = new Elysia({ prefix: "/api/og" }).get("/", async ({ request, set }) => {
  const user = await readSession(request, env);
  if (!user) {
    set.status = 401;
    return { error: "Unauthorized" };
  }

  const url = new URL(request.url).searchParams.get("url") ?? "";
  const result = await fetchOgPreview(url);
  if ("error" in result) {
    set.status = result.status;
    return { error: result.error };
  }
  return result;
});

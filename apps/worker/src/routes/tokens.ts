import { env } from "cloudflare:workers";
import { Elysia } from "elysia";
import { readSession } from "../auth/session.ts";
import {
  createTokenForUser,
  listTokensForUser,
  revokeTokenForUser,
} from "../auth/tokens.ts";

type CreateTokenBody = {
  name?: string;
};

async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export const tokenRoutes = new Elysia({ prefix: "/api/tokens" })
  .get("/", async ({ request, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const tokens = await listTokensForUser(env, user.id);
    return { tokens };
  })
  .post("/", async ({ request, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const body = await parseJsonBody<CreateTokenBody>(request);
    const created = await createTokenForUser(env, user.id, body?.name ?? "");
    if ("error" in created) {
      set.status = 400;
      return { error: created.error };
    }

    set.status = 201;
    return created;
  })
  .delete("/:id", async ({ request, params, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const result = await revokeTokenForUser(env, user.id, params.id);
    if (result === "not_found") {
      set.status = 404;
      return { error: "Not found" };
    }

    set.status = 204;
    return new Response(null, { status: 204 });
  });

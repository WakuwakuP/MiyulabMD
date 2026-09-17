import { env } from "cloudflare:workers";
import type { ParaEnableInput } from "@miyulabmd/shared";
import { Elysia } from "elysia";

import { readSession } from "../auth/session.ts";
import {
  enablePara,
  paraArchiveProject,
  paraList,
  paraPlan,
} from "../services/para.ts";

async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

export const paraRoutes = new Elysia({ prefix: "/api/para" })
  .get("/", async ({ request, set }) => {
    const user = await readSession(request, env);
    const bucket = new URL(request.url).searchParams.get("bucket") ?? undefined;
    const result = await paraList(env, user ?? undefined, bucket);
    if (result.kind === "denied") {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    if (result.kind === "invalid") {
      set.status = result.status;
      return { error: result.error };
    }
    return result.result;
  })
  .get("/plan", async ({ request, set }) => {
    const user = await readSession(request, env);
    // ?space=… is accepted for forward compatibility (§2.5) but only the
    // default space exists for now.
    const result = await paraPlan(env, user ?? undefined);
    if (result.kind === "denied") {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    return result.plan;
  })
  .post("/enable", async ({ request, set }) => {
    const user = await readSession(request, env);
    const body = await parseJsonBody<ParaEnableInput>(request);
    const result = await enablePara(env, body ?? {}, user ?? undefined);
    if (result.kind === "not_found") {
      set.status = 404;
      return { error: "Not found" };
    }
    if (result.kind === "denied") {
      set.status = result.status;
      return { error: result.status === 401 ? "Unauthorized" : "Forbidden" };
    }
    if (result.kind === "invalid") {
      set.status = result.status;
      return { error: result.error };
    }
    return result.result;
  })
  .post("/archive", async ({ request, set }) => {
    const user = await readSession(request, env);
    const body = await parseJsonBody<{
      folderId?: string;
      dated?: boolean;
      name?: string;
      dryRun?: boolean;
    }>(request);
    if (!body?.folderId) {
      set.status = 400;
      return { error: "folderId が必要です" };
    }
    const result = await paraArchiveProject(
      env,
      body.folderId,
      { dated: body.dated, dryRun: body.dryRun, name: body.name },
      user ?? undefined,
    );
    if (result.kind === "not_found") {
      set.status = 404;
      return { error: "Not found" };
    }
    if (result.kind === "denied") {
      set.status = result.status;
      return { error: result.status === 401 ? "Unauthorized" : "Forbidden" };
    }
    if (result.kind === "invalid") {
      set.status = result.status;
      return { error: result.error };
    }
    return result.result;
  });

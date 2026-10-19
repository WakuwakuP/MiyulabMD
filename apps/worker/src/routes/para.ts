import { env } from "cloudflare:workers";
import type { ParaEnableInput } from "@miyulabmd/shared";
import { Elysia } from "elysia";

import { readSession } from "../auth/session.ts";
import {
  canEditSubject,
  seesSubjectTree,
} from "../services/drive-membership.ts";
import {
  enablePara,
  paraArchiveProject,
  paraDeleteSpace,
  paraList,
  paraPlan,
  paraRenameSpace,
} from "../services/para.ts";

async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

async function subjectActor(
  user: NonNullable<Awaited<ReturnType<typeof readSession>>>,
  ownerId: string | null,
  write: boolean,
) {
  if (!ownerId || ownerId === user.id) {
    return user;
  }
  const allowed = write
    ? await canEditSubject(env, ownerId, user)
    : await seesSubjectTree(env, ownerId, user);
  if (!allowed) {
    return null;
  }
  return { ...user, id: ownerId };
}

function errorStatus(
  set: { status?: number | string },
  result: { kind: string; status?: number; error?: string },
) {
  if (result.kind === "not_found") {
    set.status = 404;
    return { error: "Not found" };
  }
  if (result.kind === "denied") {
    set.status = result.status ?? 403;
    return { error: result.status === 401 ? "Unauthorized" : "Forbidden" };
  }
  set.status = result.status ?? 400;
  return { error: result.error ?? "Invalid request" };
}

export const paraRoutes = new Elysia({ prefix: "/api/para" })
  .get("/", async ({ request, set }) => {
    const user = await readSession(request, env);
    const params = new URL(request.url).searchParams;
    const actor = user
      ? await subjectActor(user, params.get("ownerId"), false)
      : null;
    const bucket = params.get("bucket") ?? undefined;
    // §2.5: ?space= narrows the response to one space (name, id, or
    // "default"); bucket children resolve inside that space.
    const space = params.get("space") ?? undefined;
    if (user && !actor) {
      set.status = 403;
      return { error: "Forbidden" };
    }
    const result = await paraList(env, actor ?? undefined, bucket, space);
    if (result.kind !== "ok") {
      return errorStatus(set, result);
    }
    return result.result;
  })
  .get("/plan", async ({ request, set }) => {
    const user = await readSession(request, env);
    const params = new URL(request.url).searchParams;
    const actor = user
      ? await subjectActor(user, params.get("ownerId"), false)
      : null;
    if (user && !actor) {
      set.status = 403;
      return { error: "Forbidden" };
    }
    // §2.5: ?space=<name|id|"default"> selects the space to inspect.
    const space = params.get("space") ?? undefined;
    const result = await paraPlan(env, actor ?? undefined, space);
    if (result.kind !== "ok") {
      return errorStatus(set, result);
    }
    return result.plan;
  })
  .post("/enable", async ({ request, set }) => {
    const user = await readSession(request, env);
    const body = await parseJsonBody<ParaEnableInput & { ownerId?: string }>(
      request,
    );
    const actor = user
      ? await subjectActor(user, body?.ownerId ?? null, true)
      : null;
    if (user && !actor) {
      set.status = 403;
      return { error: "Forbidden" };
    }
    const result = await enablePara(env, body ?? {}, actor ?? undefined);
    if (result.kind !== "ok") {
      return errorStatus(set, result);
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
    if (result.kind !== "ok") {
      return errorStatus(set, result);
    }
    return result.result;
  })
  .patch("/spaces/:id", async ({ params, request, set }) => {
    const user = await readSession(request, env);
    const body = await parseJsonBody<{ name?: string }>(request);
    if (typeof body?.name !== "string") {
      set.status = 400;
      return { error: "name が必要です" };
    }
    const result = await paraRenameSpace(
      env,
      params.id,
      body.name,
      user ?? undefined,
    );
    if (result.kind !== "ok") {
      return errorStatus(set, result);
    }
    return { ok: true };
  })
  .delete("/spaces/:id", async ({ params, request, set }) => {
    const user = await readSession(request, env);
    // §2.5: deleting a space unassigns its buckets; folders remain.
    const result = await paraDeleteSpace(env, params.id, user ?? undefined);
    if (result.kind !== "ok") {
      return errorStatus(set, result);
    }
    return { ok: true };
  });

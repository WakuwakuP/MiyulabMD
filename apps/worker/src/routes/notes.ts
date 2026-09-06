import { env } from "cloudflare:workers";
import type {
  CreateNoteInput,
  Note,
  SessionUser,
  UpdateNoteMetaInput,
} from "@miyulabmd/shared";
import { Elysia } from "elysia";

import { readSession } from "../auth/session.ts";
import { createNoteService, type MutateNoteResult } from "../services/notes.ts";

const notes = createNoteService(env);

type PatchNoteBody = UpdateNoteMetaInput & {
  markdown?: string;
};

type RouteSet = { status?: number | string };

async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function patchHasMetaFields(meta: UpdateNoteMetaInput): boolean {
  return (
    meta.title !== undefined ||
    meta.permission !== undefined ||
    meta.alias !== undefined ||
    meta.folder !== undefined ||
    meta.inheritAccess !== undefined ||
    meta.readScope !== undefined ||
    meta.writeScope !== undefined ||
    meta.grants !== undefined
  );
}

function mutateResultError(
  set: RouteSet,
  result: Exclude<MutateNoteResult, { kind: "ok" }>,
): { error: string } {
  if (result.kind === "not_found") {
    set.status = 404;
    return { error: "Not found" };
  }
  if (result.kind === "bad_request") {
    set.status = 400;
    return { error: result.error };
  }
  set.status = result.status;
  return { error: result.status === 401 ? "Unauthorized" : "Forbidden" };
}

async function applyNotePatch(
  id: string,
  user: SessionUser | undefined,
  body: PatchNoteBody,
  set: RouteSet,
): Promise<{ error: string } | Note> {
  const { markdown, ...meta } = body;
  let latest = null as MutateNoteResult | null;

  if (patchHasMetaFields(meta)) {
    latest = await notes.updateMeta(id, user, meta);
    if (latest.kind !== "ok") {
      return mutateResultError(set, latest);
    }
  }

  if (markdown !== undefined) {
    const markdownResult = await notes.updateMarkdown(id, user, markdown);
    if (markdownResult.kind !== "ok") {
      return mutateResultError(set, markdownResult);
    }
    latest = markdownResult;
  }

  if (latest?.kind !== "ok") {
    set.status = 400;
    return { error: "No fields to update" };
  }

  return latest.note;
}

export const noteRoutes = new Elysia({ prefix: "/api/notes" })
  .get("/", async ({ request }) => {
    const user = await readSession(request, env);
    const list = user
      ? await notes.listForUser(user)
      : await notes.listForGuest();
    return { notes: list };
  })
  .post("/", async ({ request, set }) => {
    const user = await readSession(request, env);
    const body = await parseJsonBody<CreateNoteInput>(request);

    const created = await notes.create(user ?? undefined, body ?? {});
    if ("error" in created) {
      set.status = created.status;
      return { error: created.error };
    }

    set.status = 201;
    return created;
  })
  .get("/:id", async ({ request, params, set }) => {
    const user = await readSession(request, env);
    const result = await notes.get(params.id, user ?? undefined);

    if (result.kind === "not_found") {
      set.status = 404;
      return { error: "Not found" };
    }
    if (result.kind === "denied") {
      set.status = result.status;
      return { error: result.status === 401 ? "Unauthorized" : "Forbidden" };
    }

    return result.note;
  })
  .patch("/:id", async ({ request, params, set }) => {
    const user = await readSession(request, env);
    const body = await parseJsonBody<PatchNoteBody>(request);
    if (!body) {
      set.status = 400;
      return { error: "Invalid JSON body" };
    }

    return applyNotePatch(params.id, user ?? undefined, body, set);
  })
  .delete("/:id", async ({ request, params, set }) => {
    const user = await readSession(request, env);
    const result = await notes.remove(params.id, user ?? undefined);

    if (result.kind === "not_found") {
      set.status = 404;
      return { error: "Not found" };
    }
    if (result.kind === "denied") {
      set.status = result.status;
      return { error: result.status === 401 ? "Unauthorized" : "Forbidden" };
    }

    set.status = 204;
    return new Response(null, { status: 204 });
  });

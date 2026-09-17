import { env } from "cloudflare:workers";
import { isTaskCheckboxUpdate } from "@miyulabmd/markdown";
import {
  type CreateNoteInput,
  isNoteLayer,
  LAYER_RANK,
  NOTE_RESTORE_MESSAGE,
  type Note,
  type NoteLayer,
  type SessionUser,
  type UpdateNoteMetaInput,
} from "@miyulabmd/shared";
import { Elysia } from "elysia";

import { readSession } from "../auth/session.ts";
import { actorFromSessionUser } from "../durable-objects/history-edit.ts";
import { getNoteRevision, listNoteEditEvents } from "../services/history.ts";
import {
  demoteNote,
  listLayerEvents,
  promoteNote,
  setNoteLayer,
  unlockGoldForEdit,
} from "../services/layers.ts";
import { listNoteLinks } from "../services/links.ts";
import { moveNotes } from "../services/move.ts";
import { createNoteService, type MutateNoteResult } from "../services/notes.ts";

function documentRoom(noteId: string) {
  return env.DOCUMENT_ROOM.get(env.DOCUMENT_ROOM.idFromName(noteId));
}

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

function layerErrorResponse(
  set: RouteSet,
  result: Exclude<Awaited<ReturnType<typeof promoteNote>>, { kind: "ok" }>,
): unknown {
  if (result.kind === "not_found") {
    set.status = 404;
    return { error: "Not found" };
  }
  if (result.kind === "denied") {
    set.status = result.status;
    return { error: result.status === 401 ? "Unauthorized" : "Forbidden" };
  }
  if (result.kind === "gates") {
    // 機械可読な昇格ゲート失敗。
    set.status = 422;
    return { failures: result.failures, to: result.to };
  }
  set.status = result.status;
  return { error: result.error };
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
  return {
    error:
      result.code ?? (result.status === 401 ? "Unauthorized" : "Forbidden"),
  };
}

function applyLayerChange(
  id: string,
  to: NoteLayer,
  rank: number,
  body: { confirm?: boolean; reason?: string },
  user: SessionUser | undefined,
) {
  if (rank > 1) {
    return {
      error: "昇格は1段階ずつ行います",
      kind: "invalid" as const,
      status: 400 as const,
    };
  }
  if (rank > 0) {
    return promoteNote(env, id, body.confirm, user);
  }
  if (rank < 0) {
    return demoteNote(env, id, body.reason ?? null, to, user);
  }
  return setNoteLayer(env, id, to, null, user);
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
    const layer = new URL(request.url).searchParams.get("layer");
    return {
      notes: layer ? list.filter((note) => note.layer === layer) : list,
    };
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
  .post("/move", async ({ request, set }) => {
    const user = await readSession(request, env);
    const body = await parseJsonBody<{
      noteIds?: string[];
      destFolderId?: string | null;
      dryRun?: boolean;
    }>(request);
    if (!(body && Array.isArray(body.noteIds))) {
      set.status = 400;
      return { error: "noteIds が必要です" };
    }
    const result = await moveNotes(
      env,
      {
        destFolderId: body.destFolderId,
        dryRun: body.dryRun,
        noteIds: body.noteIds,
      },
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
  })
  .get("/:id/history", async ({ request, params, set }) => {
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

    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit"));
    const before = Number(url.searchParams.get("before"));
    return listNoteEditEvents(env, result.note.id, {
      before: Number.isFinite(before) && before > 0 ? before : undefined,
      limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
    });
  })
  .get("/:id/revisions/:revisionId", async ({ request, params, set }) => {
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

    const revision = await getNoteRevision(
      env,
      result.note.id,
      params.revisionId,
    );
    if (!revision) {
      set.status = 404;
      return { error: "Not found" };
    }
    return revision;
  })
  .post(
    "/:id/revisions/:revisionId/restore",
    async ({ request, params, set }) => {
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
      if (!result.note.access.flags.canEdit) {
        set.status = user ? 403 : 401;
        return { error: user ? "Forbidden" : "Unauthorized" };
      }
      if (result.note.goldLocked) {
        set.status = 403;
        return { error: "gold_locked" };
      }

      const revision = await getNoteRevision(
        env,
        result.note.id,
        params.revisionId,
      );
      if (!revision) {
        set.status = 404;
        return { error: "Not found" };
      }

      const applied = await documentRoom(result.note.id).restoreMarkdown(
        result.note.id,
        revision.markdown,
        actorFromSessionUser(user ?? null),
      );
      if (!applied.ok) {
        set.status = 400;
        return { error: applied.message };
      }

      return {
        message: NOTE_RESTORE_MESSAGE,
        restored: true as const,
        revisionId: revision.id,
      };
    },
  )
  .post("/:id/layer", async ({ request, params, set }) => {
    const user = await readSession(request, env);
    const body = await parseJsonBody<{
      confirm?: boolean;
      reason?: string;
      to?: string;
    }>(request);
    const to = body?.to;
    if (!(to && isNoteLayer(to))) {
      set.status = 400;
      return { error: "to（bronze/silver/gold）を指定してください" };
    }
    const current = await notes.get(params.id, user ?? undefined);
    if (current.kind === "not_found") {
      set.status = 404;
      return { error: "Not found" };
    }
    if (current.kind === "denied") {
      set.status = current.status;
      return { error: current.status === 401 ? "Unauthorized" : "Forbidden" };
    }
    const outcome = await applyLayerChange(
      params.id,
      to,
      LAYER_RANK[to] - LAYER_RANK[current.note.layer],
      body,
      user ?? undefined,
    );
    if (outcome.kind !== "ok") {
      return layerErrorResponse(set, outcome);
    }
    return outcome.result;
  })
  .post("/:id/unlock", async ({ request, params, set }) => {
    const user = await readSession(request, env);
    const body = await parseJsonBody<{ minutes?: number }>(request);
    const outcome = await unlockGoldForEdit(
      env,
      params.id,
      body?.minutes,
      user ?? undefined,
    );
    if (outcome.kind !== "ok") {
      return layerErrorResponse(set, outcome);
    }
    return outcome.result;
  })
  .get("/:id/layer-events", async ({ request, params, set }) => {
    const user = await readSession(request, env);
    const outcome = await listLayerEvents(env, params.id, user ?? undefined);
    if (outcome.kind !== "ok") {
      return layerErrorResponse(set, outcome);
    }
    return outcome.result;
  })
  .get("/:id/links", async ({ request, params, set }) => {
    const user = await readSession(request, env);
    const result = await listNoteLinks(env, params.id, user ?? undefined);
    if (result.kind === "not_found") {
      set.status = 404;
      return { error: "Not found" };
    }
    if (result.kind === "denied") {
      set.status = result.status;
      return { error: result.status === 401 ? "Unauthorized" : "Forbidden" };
    }
    return result.result;
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
  .patch("/:id/task-checkbox", async ({ request, params, set }) => {
    const user = await readSession(request, env);
    const result = await notes.get(params.id, user ?? undefined);
    if (result.kind !== "ok") {
      return mutateResultError(set, result);
    }
    if (!result.note.access.flags.canEdit) {
      set.status = user ? 403 : 401;
      return { error: user ? "Forbidden" : "Unauthorized" };
    }
    if (result.note.goldLocked) {
      set.status = 403;
      return { error: "gold_locked" };
    }
    const body = await parseJsonBody<unknown>(request);
    if (!isTaskCheckboxUpdate(body)) {
      set.status = 400;
      return { error: "Invalid task checkbox update" };
    }
    const applied = await documentRoom(result.note.id).updateTaskCheckbox(
      result.note.id,
      body,
      actorFromSessionUser(user ?? null),
    );
    if (!applied.ok) {
      set.status = 409;
      return {
        error:
          "本文が変更されています。再読み込みしてからチェック状態を更新してください。",
        ok: false,
      };
    }
    return applied;
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

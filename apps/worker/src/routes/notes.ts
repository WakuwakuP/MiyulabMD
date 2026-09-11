import { env } from "cloudflare:workers";
import { isTaskCheckboxUpdate } from "@miyulabmd/markdown";
import {
  type CreateNoteInput,
  isConditionalMarkdownUpdate,
  NOTE_RESTORE_MESSAGE,
  type Note,
  type SessionUser,
  type UpdateNoteMarkdownInput,
  type UpdateNoteMetaInput,
} from "@miyulabmd/shared";
import { Elysia } from "elysia";

import { readSession } from "../auth/session.ts";
import { actorFromSessionUser } from "../durable-objects/history-edit.ts";
import { getNoteRevision, listNoteEditEvents } from "../services/history.ts";
import {
  createNoteService,
  type CreateNoteResult,
  type MutateNoteResult,
} from "../services/notes.ts";

function documentRoom(noteId: string) {
  return env.DOCUMENT_ROOM.get(env.DOCUMENT_ROOM.idFromName(noteId));
}

const notes = createNoteService(env);

type PatchNoteBody = UpdateNoteMetaInput &
  Partial<UpdateNoteMarkdownInput>;

type RouteSet = { status?: number | string };

type ErrorBody = { error: string; code?: string };

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
): ErrorBody {
  if (result.kind === "not_found") {
    set.status = 404;
    return { error: "Not found" };
  }
  if (result.kind === "bad_request") {
    set.status = 400;
    return { error: result.error };
  }
  if (result.kind === "conflict") {
    set.status = result.status;
    return { code: result.code, error: result.error };
  }
  set.status = result.status;
  return { error: result.status === 401 ? "Unauthorized" : "Forbidden" };
}

function createResultError(
  set: RouteSet,
  result: Extract<CreateNoteResult, { kind: "error" }>,
): ErrorBody {
  set.status = result.status;
  return result.code
    ? { code: result.code, error: result.error }
    : { error: result.error };
}

async function applyMarkdownViaRoom(
  noteId: string,
  prep: Extract<
    Awaited<ReturnType<typeof notes.prepareMarkdownUpdate>>,
    { kind: "ok" }
  >,
  conditional: boolean,
  set: RouteSet,
): Promise<ErrorBody | null> {
  if (conditional) {
    const applied = await documentRoom(noteId).applyMarkdownConditional(
      noteId,
      prep.expectedMarkdown,
      prep.markdown,
    );
    if (!applied.ok) {
      set.status = 409;
      return { code: applied.code, error: applied.error };
    }
    return null;
  }

  await documentRoom(noteId).applyMarkdownAndPersist(prep.markdown, noteId);
  return null;
}

async function applyNotePatch(
  id: string,
  user: SessionUser | undefined,
  body: PatchNoteBody,
  set: RouteSet,
): Promise<ErrorBody | Note> {
  const { markdown, expectedMarkdown, clientDraftId, draftOwnerId, ...meta } =
    body;
  let latest = null as MutateNoteResult | null;

  if (patchHasMetaFields(meta)) {
    latest = await notes.updateMeta(id, user, meta);
    if (latest.kind !== "ok") {
      return mutateResultError(set, latest);
    }
  }

  if (markdown !== undefined) {
    const markdownInput: UpdateNoteMarkdownInput = {
      clientDraftId,
      draftOwnerId,
      expectedMarkdown,
      markdown,
    };
    const conditional = isConditionalMarkdownUpdate(markdownInput);
    const prep = await notes.prepareMarkdownUpdate(id, user, markdownInput);
    if (prep.kind !== "ok") {
      return mutateResultError(set, prep);
    }

    const roomError = await applyMarkdownViaRoom(
      prep.noteId,
      prep,
      conditional,
      set,
    );
    if (roomError) {
      return roomError;
    }

    latest = await notes.noteAfterMarkdownPersisted(prep.noteId, user);
    if (latest.kind !== "ok") {
      return mutateResultError(set, latest);
    }
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
    if (created.kind === "error") {
      return createResultError(set, created);
    }

    set.status = created.kind === "replayed" ? 200 : 201;
    return created.note;
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

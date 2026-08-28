import { env } from "cloudflare:workers";
import { Elysia } from "elysia";
import {
  clampWriteScope,
  isAccessScope,
  normalizeFolder,
  type AccessGrantInput,
  type UpdateFolderAccessInput,
} from "@miyulabmd/shared";

import { readSession } from "../auth/session.ts";
import {
  createOwnedFolder,
  deleteFolderPolicy,
  getFolderById,
  listOwnedFolders,
  parentFolderPath,
  replaceGrants,
  resolveFolderAccess,
  upsertFolderPolicy,
} from "../services/access.ts";
import { createNoteService } from "../services/notes.ts";
import { instanceFlags } from "../env.ts";

const notes = createNoteService(env);

async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function normalizeFolderName(name: string): string | null {
  const normalized = normalizeFolder(name);
  if (!normalized || normalized.includes("/")) return null;
  return normalized;
}

async function applyFolderAccessPatch(
  ownerId: string,
  folder: string,
  body: UpdateFolderAccessInput,
): Promise<{ error: string; status: number } | null> {
  if (!folder) {
    return { error: "ルートディレクトリの範囲は自分のみで固定です", status: 400 };
  }

  const current = await resolveFolderAccess(env, ownerId, folder, { id: ownerId, email: "", displayName: null });

  if (body.inherit === true) {
    await deleteFolderPolicy(env, ownerId, folder);
  } else if (
    body.inherit === false ||
    body.readScope !== undefined ||
    body.writeScope !== undefined
  ) {
    const fallback = {
      readScope: current.effectiveReadScope,
      writeScope: current.effectiveWriteScope,
    };
    const readScope = isAccessScope(body.readScope ?? "") ? body.readScope! : fallback.readScope;
    const writeScope = clampWriteScope(
      readScope,
      isAccessScope(body.writeScope ?? "") ? body.writeScope! : fallback.writeScope,
    );
    if (writeScope === "public" && !instanceFlags(env).allowAnonymousEdits) {
      return { error: "全体公開の書き込みは、匿名編集が無効なため使えません", status: 400 };
    }
    await upsertFolderPolicy(env, ownerId, folder, readScope, writeScope);
  }

  if (body.grants) {
    const replaced = await replaceGrants(env, ownerId, "folder", folder, body.grants as AccessGrantInput[]);
    if ("error" in replaced) {
      return { error: replaced.error, status: 400 };
    }
  }

  return null;
}

export const folderRoutes = new Elysia({ prefix: "/api/folders" })
  .get("/tree", async ({ request, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    const folders = await listOwnedFolders(env, user.id);
    return { folders };
  })
  .get("/:id", async ({ params, request, set }) => {
    const user = await readSession(request, env);
    const rec = await getFolderById(env, params.id);
    if (!rec) {
      set.status = 404;
      return { error: "Not found" };
    }

    const access = await resolveFolderAccess(env, rec.owner_id, rec.folder, user);
    if (!access.flags.canView) {
      set.status = 404;
      return { error: "Not found" };
    }
    return access;
  })
  .get("/", async ({ request, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const path = normalizeFolder(new URL(request.url).searchParams.get("path") ?? "");
    const access = await resolveFolderAccess(env, user.id, path, user);
    return access;
  })
  .post("/", async ({ request, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const body = await parseJsonBody<{ folder?: string; name?: string; parentId?: string }>(request);
    let folder = normalizeFolder(body?.folder ?? "");

    if (!folder && body?.name) {
      const name = normalizeFolderName(body.name);
      if (!name) {
        set.status = 400;
        return { error: "フォルダ名が不正です" };
      }
      if (body.parentId) {
        const parent = await getFolderById(env, body.parentId);
        if (!parent || parent.owner_id !== user.id) {
          set.status = 404;
          return { error: "Not found" };
        }
        folder = parent.folder ? `${parent.folder}/${name}` : name;
      } else {
        folder = name;
      }
    }

    if (!folder) {
      set.status = 400;
      return { error: "ルートにはフォルダを作成できません" };
    }

    const parent = parentFolderPath(folder);
    if (parent) {
      const parentAccess = await resolveFolderAccess(env, user.id, parent, user);
      if (!parentAccess.flags.canAdmin) {
        set.status = 403;
        return { error: "このフォルダには作成権限がありません" };
      }
    }

    const access = await createOwnedFolder(env, user.id, folder, user);
    set.status = 201;
    return access;
  })
  .patch("/", async ({ request, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const body = await parseJsonBody<UpdateFolderAccessInput>(request);
    if (!body) {
      set.status = 400;
      return { error: "Invalid JSON body" };
    }

    let folder = normalizeFolder(body.folder ?? "");
    if (body.folderId) {
      const rec = await getFolderById(env, body.folderId);
      if (!rec || rec.owner_id !== user.id) {
        set.status = 404;
        return { error: "Not found" };
      }
      folder = rec.folder;
    }

    const applied = await applyFolderAccessPatch(user.id, folder, body);
    if (applied) {
      set.status = applied.status;
      return { error: applied.error };
    }

    return resolveFolderAccess(env, user.id, folder, user);
  })
  .delete("/:id", async ({ params, request, set }) => {
    const user = await readSession(request, env);
    if (!user) {
      set.status = 401;
      return { error: "Unauthorized" };
    }

    const result = await notes.removeFolder(params.id, user);
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

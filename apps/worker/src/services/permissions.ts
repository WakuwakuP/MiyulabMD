import type { Actor, PermissionFlags, SessionUser } from "@miyulabmd/shared";
import { actorFromUser } from "@miyulabmd/shared";

import { instanceFlags } from "../env.ts";
import { type NoteAccessFields, resolveNoteAccess } from "./access.ts";

export type PermissionContext = {
  ownerId: string;
  flags: PermissionFlags;
};

export function applyInstanceFlags(
  flags: PermissionFlags,
  actor: Actor,
  env: Env,
): PermissionFlags {
  if (actor.kind !== "guest") {
    return flags;
  }

  const { allowAnonymousViews, allowAnonymousEdits } = instanceFlags(env);
  if (!allowAnonymousViews) {
    return { canView: false, canEdit: false, canAdmin: false };
  }
  if (!allowAnonymousEdits) {
    return { ...flags, canEdit: false, canAdmin: false };
  }
  return flags;
}

export function resolvePermissionWithFlags(
  ctx: PermissionContext,
  _userId: string | undefined,
  _env: Env,
): PermissionFlags {
  return ctx.flags;
}

export function viewDeniedHttpStatus(
  _ctx: PermissionContext,
  userId: string | undefined,
  _env: Env,
): 401 | 403 {
  return userId ? 403 : 401;
}

export async function permissionContextForNote(
  env: Env,
  note: NoteAccessFields,
  user?: SessionUser | null,
): Promise<PermissionContext> {
  const access = await resolveNoteAccess(env, note, user);
  return { ownerId: note.ownerId, flags: access.flags };
}

export { actorFromUser };

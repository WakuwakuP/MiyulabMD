import {
  evaluatePermission,
  type Actor,
  type CollaboratorRole,
  type PermissionFlags,
  type PermissionPreset,
} from "@miyulabmd/shared";

export type PermissionContext = {
  preset: PermissionPreset;
  ownerId: string;
  collaboratorRole?: CollaboratorRole;
};

export function actorFromUser(userId: string | undefined, ownerId: string): Actor {
  if (!userId) return { kind: "guest" };
  if (userId === ownerId) return { kind: "owner", userId };
  return { kind: "signed_in", userId };
}

export function resolvePermission(ctx: PermissionContext, userId?: string): PermissionFlags {
  return evaluatePermission(ctx.preset, actorFromUser(userId, ctx.ownerId), ctx.collaboratorRole);
}

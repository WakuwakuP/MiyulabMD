import type { PermissionFlags } from "@miyulabmd/shared";

export type PermissionContext = {
  ownerId: string;
  flags: PermissionFlags;
};

export function viewDeniedHttpStatus(
  _ctx: PermissionContext,
  userId: string | undefined,
  _env: Env,
): 401 | 403 {
  return userId ? 403 : 401;
}

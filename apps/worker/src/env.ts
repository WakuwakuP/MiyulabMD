import type { PermissionPreset } from "@miyulabmd/shared";
import { isPermissionPreset } from "@miyulabmd/shared";

export function envTruthy(value: string): boolean {
  return value === "true";
}

/** Elysia ルートからは `import { env } from "cloudflare:workers"` で参照する。 */
export function instanceFlags(env: Env) {
  const defaultPermission: PermissionPreset = isPermissionPreset(
    env.DEFAULT_PERMISSION,
  )
    ? env.DEFAULT_PERMISSION
    : "editable";

  return {
    allowAnonymous: envTruthy(env.ALLOW_ANONYMOUS),
    allowAnonymousEdits: envTruthy(env.ALLOW_ANONYMOUS_EDITS),
    allowAnonymousViews: envTruthy(env.ALLOW_ANONYMOUS_VIEWS),
    defaultPermission,
  };
}

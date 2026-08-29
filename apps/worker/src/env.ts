import type { PermissionPreset } from "@miyulabmd/shared";
import { isPermissionPreset } from "@miyulabmd/shared";

/** Elysia ルートからは `import { env } from "cloudflare:workers"` で参照する。 */
export function instanceFlags(env: Env) {
  const defaultPermission: PermissionPreset = isPermissionPreset(
    env.DEFAULT_PERMISSION,
  )
    ? env.DEFAULT_PERMISSION
    : "editable";

  return {
    allowAnonymous: env.ALLOW_ANONYMOUS === "true",
    allowAnonymousEdits: env.ALLOW_ANONYMOUS_EDITS === "true",
    allowAnonymousViews: env.ALLOW_ANONYMOUS_VIEWS === "true",
    defaultPermission,
  };
}

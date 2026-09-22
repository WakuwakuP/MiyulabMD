import type { AccessGrant, AccessScope } from "@miyulabmd/shared";

export type AccessDraft = {
  inherit: boolean;
  readScope: AccessScope;
  writeScope: AccessScope;
  grants: AccessGrant[];
};

/** Longest scope label is 指定ユーザーのみ / ログイン済みのみ. */
export const accessScopeSelectClass = "w-[11rem] shrink-0";

import type { SessionUser } from "@miyulabmd/shared";
import { db } from "../db/client.ts";

/** Tool exposure follows current backing rows, not cached UI feature flags. */
export async function featureConfig(env: Env, user: SessionUser | null) {
  if (!user) {
    return { hasMedallion: false, hasPara: false, hasSchemes: false };
  }
  // Three indexed existence checks, one D1 round trip and one result row.
  const row = await db(env)
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM para_spaces WHERE owner_id = ?) AS hasPara,
         EXISTS (SELECT 1 FROM medallion_sets WHERE owner_user_id = ?) AS hasMedallion,
         EXISTS (SELECT 1 FROM folders WHERE owner_id = ? AND scheme IS NOT NULL) AS hasSchemes`,
    )
    .bind(user.id, user.id, user.id)
    .first<{ hasMedallion: number; hasPara: number; hasSchemes: number }>();
  return {
    hasMedallion: row?.hasMedallion === 1,
    hasPara: row?.hasPara === 1,
    hasSchemes: row?.hasSchemes === 1,
  };
}

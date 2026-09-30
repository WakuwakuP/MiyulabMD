import {
  KNOWLEDGE_FEATURE_KEYS,
  parseUserSettingsObject,
  type UserSettings,
  userSettingsFromObject,
} from "@miyulabmd/shared";
import { db } from "../db/client.ts";
import type { UserSettingsPatch } from "./settings-input.ts";

type SettingsRow = {
  settings: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Work from the current stored value inside the UPDATE, never a stale read.
// Guard json_type behind json_valid so legacy malformed JSON is safe to repair.
const SETTINGS_OBJECT_SQL = `CASE WHEN json_valid(settings)
  THEN CASE WHEN json_type(settings) = 'object' THEN settings ELSE '{}' END
  ELSE '{}' END`;
const SETTINGS_WITH_PARA_SQL = `json_patch(${SETTINGS_OBJECT_SQL},
  CASE WHEN json_type(${SETTINGS_OBJECT_SQL}, '$.knowledge.para') IN ('true', 'false')
    THEN '{}'
    ELSE json_object('knowledge', json_object('para', json(
      CASE WHEN EXISTS (SELECT 1 FROM folders
        WHERE owner_id = users.id AND para_bucket IS NOT NULL)
      THEN 'true' ELSE 'false' END)))
  END)`;

/** Atomic partial merge, including legacy PARA derivation, preserving other writers. */
async function persistSettingsPatch(
  env: Env,
  userId: string,
  patch: Record<string, unknown>,
): Promise<UserSettings | null> {
  const row = await db(env)
    .prepare(`UPDATE users SET settings = json_patch(${SETTINGS_WITH_PARA_SQL}, ?)
      WHERE id = ? RETURNING settings`)
    .bind(JSON.stringify(patch), userId)
    .first<SettingsRow>();
  return row
    ? userSettingsFromObject(parseUserSettingsObject(row.settings))
    : null;
}

/**
 * users.settings を読み、デフォルトを埋めた UserSettings を返す。
 * knowledge.para が未保存なら導出値を永続化する（遅延移行）。
 * ユーザー行が無い場合はデフォルトを返すだけで永続化しない。
 */
export async function readUserSettings(
  env: Env,
  userId: string,
): Promise<UserSettings> {
  const row = await db(env)
    .prepare("SELECT settings FROM users WHERE id = ?")
    .bind(userId)
    .first<SettingsRow>();

  const raw = parseUserSettingsObject(row?.settings);
  const storedKnowledge = isRecord(raw.knowledge) ? raw.knowledge : {};
  if (row && typeof storedKnowledge.para !== "boolean") {
    // The conditional derivation and merge read the latest DB value. Another
    // request may have saved protections or an explicit para flag since SELECT.
    return (
      (await persistSettingsPatch(env, userId, {})) ??
      userSettingsFromObject({})
    );
  }

  return userSettingsFromObject(raw);
}

/**
 * settings.knowledge の部分更新。パッチは既知キーの真偽値のみ採用し、
 * 保存済みの未知キー・トップレベルキーは保持する。
 * knowledge.para が結果として未設定なら導出して埋める。
 * ユーザーが存在しなければ null。
 */
export async function updateUserKnowledgeSettings(
  env: Env,
  userId: string,
  patch: Record<string, unknown>,
): Promise<UserSettings | null> {
  return await updateUserSettings(env, userId, { knowledge: patch });
}

/** Merge only supplied settings fields, preserving stored future keys. */
export async function updateUserSettings(
  env: Env,
  userId: string,
  patch: UserSettingsPatch,
): Promise<UserSettings | null> {
  const knowledge: Record<string, boolean> = {};
  for (const key of KNOWLEDGE_FEATURE_KEYS) {
    const value = patch.knowledge?.[key];
    if (typeof value === "boolean") {
      knowledge[key] = value;
    }
  }
  const next: Record<string, unknown> = { knowledge };
  if (patch.folderDeletion) {
    const folderDeletion: Record<string, string[]> = {};
    for (const key of [
      "protectedFolderIds",
      "protectedPathPatterns",
    ] as const) {
      const values = patch.folderDeletion[key];
      if (values !== undefined) {
        folderDeletion[key] = values;
      }
    }
    next.folderDeletion = folderDeletion;
  }
  return await persistSettingsPatch(env, userId, next);
}

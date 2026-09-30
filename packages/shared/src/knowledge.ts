/**
 * ナレッジ管理フレームワーク機能の opt-in フラグ。
 * specs/knowledge-management.html §2.1 / §2.3 / §2.7 参照。
 * wiki-link と検索 DSL は標準機能のためフラグを持たない。
 */
export const KNOWLEDGE_FEATURE_KEYS = ["para", "schemes", "layers"] as const;

export type KnowledgeFeatureKey = (typeof KNOWLEDGE_FEATURE_KEYS)[number];

export type KnowledgeSettings = Record<KnowledgeFeatureKey, boolean>;

/**
 * 新規フレームワーク（para）は opt-in でデフォルト OFF。
 * 既存の常時 ON 機能（schemes / layers）は後方互換のためデフォルト ON。
 */
export const DEFAULT_KNOWLEDGE_SETTINGS: KnowledgeSettings = {
  layers: true,
  para: false,
  schemes: true,
};

/** Empty-folder deletion protection, independent of knowledge feature flags. */
export type FolderDeletionSettings = {
  protectedFolderIds: string[];
  protectedPathPatterns: string[];
};

export const DEFAULT_FOLDER_DELETION_SETTINGS: FolderDeletionSettings = {
  protectedFolderIds: [],
  protectedPathPatterns: [],
};

export type UserSettings = {
  folderDeletion: FolderDeletionSettings;
  knowledge: KnowledgeSettings;
};

export const DEFAULT_USER_SETTINGS: UserSettings = {
  folderDeletion: DEFAULT_FOLDER_DELETION_SETTINGS,
  knowledge: DEFAULT_KNOWLEDGE_SETTINGS,
};

export function isKnowledgeFeatureKey(
  value: unknown,
): value is KnowledgeFeatureKey {
  return (KNOWLEDGE_FEATURE_KEYS as readonly string[]).includes(
    value as string,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [
    ...new Set(
      value
        .filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
        .map((item) => item.trim()),
    ),
  ];
}

/** Read older/malformed settings without mutating the shared defaults. */
export function normalizeFolderDeletionSettings(
  value: unknown,
): FolderDeletionSettings {
  const raw = isRecord(value) ? value : {};
  return {
    protectedFolderIds: normalizeStringList(raw.protectedFolderIds),
    protectedPathPatterns: normalizeStringList(raw.protectedPathPatterns),
  };
}

/**
 * 保存済み knowledge オブジェクトを正規化する。既知キーの真偽値のみ採用し、
 * 欠損キーはデフォルトで埋める（非真偽値・未知キーは無視）。
 */
export function normalizeKnowledgeSettings(value: unknown): KnowledgeSettings {
  const next = { ...DEFAULT_KNOWLEDGE_SETTINGS };
  if (isRecord(value)) {
    for (const key of KNOWLEDGE_FEATURE_KEYS) {
      const flag = value[key];
      if (typeof flag === "boolean") {
        next[key] = flag;
      }
    }
  }
  return next;
}

/** users.settings JSON 列のパース。未設定・壊れた JSON・非オブジェクトは {}。 */
export function parseUserSettingsObject(
  raw: string | null | undefined,
): Record<string, unknown> {
  if (typeof raw !== "string" || raw.length === 0) {
    return {};
  }
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

export function userSettingsFromObject(
  raw: Record<string, unknown>,
): UserSettings {
  return {
    folderDeletion: normalizeFolderDeletionSettings(raw.folderDeletion),
    knowledge: normalizeKnowledgeSettings(raw.knowledge),
  };
}

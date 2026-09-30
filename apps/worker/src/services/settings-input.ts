import type { FolderDeletionSettings } from "@miyulabmd/shared";

export type UserSettingsPatch = {
  folderDeletion?: Partial<FolderDeletionSettings>;
  knowledge?: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFolderDeletionPatch(
  value: unknown,
): { patch: Partial<FolderDeletionSettings> } | { error: string } {
  if (!isRecord(value)) {
    return { error: "settings.folderDeletion must be an object" };
  }
  const patch: Partial<FolderDeletionSettings> = {};
  for (const key of ["protectedFolderIds", "protectedPathPatterns"] as const) {
    const list = value[key];
    if (list === undefined) {
      continue;
    }
    if (
      !(
        Array.isArray(list) &&
        list.every(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
      )
    ) {
      return {
        error: `settings.folderDeletion.${key} must be an array of non-empty strings`,
      };
    }
    patch[key] = [...new Set(list.map((item) => item.trim()))];
  }
  return { patch };
}

/** Validate the complete settings patch before any account fields are written. */
export function parseUserSettingsPatch(
  value: unknown,
): { patch: UserSettingsPatch } | { error: string } {
  if (!isRecord(value)) {
    return { error: "settings must be an object" };
  }
  const patch: UserSettingsPatch = {};
  if (value.knowledge !== undefined) {
    if (!isRecord(value.knowledge)) {
      return { error: "settings.knowledge must be an object" };
    }
    patch.knowledge = value.knowledge;
  }
  if (value.folderDeletion !== undefined) {
    const parsed = parseFolderDeletionPatch(value.folderDeletion);
    if ("error" in parsed) {
      return parsed;
    }
    patch.folderDeletion = parsed.patch;
  }
  return { patch };
}

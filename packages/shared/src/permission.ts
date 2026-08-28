/** CodiMD 互換のノート公開範囲。変更できるのは owner のみ。 */
export const PERMISSION_PRESETS = [
  "freely",
  "editable",
  "limited",
  "locked",
  "protected",
  "private",
] as const;

export type PermissionPreset = (typeof PERMISSION_PRESETS)[number];

export const COLLABORATOR_ROLES = ["viewer", "editor"] as const;
export type CollaboratorRole = (typeof COLLABORATOR_ROLES)[number];

export type ActorKind = "owner" | "signed_in" | "guest";

export type Actor = {
  kind: ActorKind;
  userId?: string;
};

export type PermissionFlags = {
  canView: boolean;
  canEdit: boolean;
  canAdmin: boolean;
};

const PRESET_MATRIX: Record<
  PermissionPreset,
  { signedInRead: boolean; signedInWrite: boolean; guestRead: boolean; guestWrite: boolean }
> = {
  freely: { signedInRead: true, signedInWrite: true, guestRead: true, guestWrite: true },
  editable: { signedInRead: true, signedInWrite: true, guestRead: true, guestWrite: false },
  limited: { signedInRead: true, signedInWrite: true, guestRead: false, guestWrite: false },
  locked: { signedInRead: true, signedInWrite: false, guestRead: true, guestWrite: false },
  protected: { signedInRead: true, signedInWrite: false, guestRead: false, guestWrite: false },
  private: { signedInRead: false, signedInWrite: false, guestRead: false, guestWrite: false },
};

export function evaluatePermission(
  preset: PermissionPreset,
  actor: Actor,
  collaboratorRole?: CollaboratorRole,
): PermissionFlags {
  if (actor.kind === "owner") {
    return { canView: true, canEdit: true, canAdmin: true };
  }

  if (collaboratorRole === "editor") {
    return { canView: true, canEdit: true, canAdmin: false };
  }
  if (collaboratorRole === "viewer") {
    return { canView: true, canEdit: false, canAdmin: false };
  }

  const row = PRESET_MATRIX[preset];
  if (actor.kind === "signed_in") {
    return {
      canView: row.signedInRead,
      canEdit: row.signedInWrite,
      canAdmin: false,
    };
  }

  return {
    canView: row.guestRead,
    canEdit: row.guestWrite,
    canAdmin: false,
  };
}

export function isPermissionPreset(value: string): value is PermissionPreset {
  return (PERMISSION_PRESETS as readonly string[]).includes(value);
}

import type { PermissionFlags } from "./permission.ts";

export const OWNER_KINDS = ["user", "shared_drive"] as const;
export type OwnerKind = (typeof OWNER_KINDS)[number];

export const DRIVE_ROLES = ["manager", "editor", "viewer"] as const;
export type DriveRole = (typeof DRIVE_ROLES)[number];

export function isOwnerKind(value: string): value is OwnerKind {
  return (OWNER_KINDS as readonly string[]).includes(value);
}

export function isDriveRole(value: string): value is DriveRole {
  return (DRIVE_ROLES as readonly string[]).includes(value);
}

export function flagsForDriveRole(role: DriveRole | null): PermissionFlags {
  if (role === "manager") {
    return { canAdmin: true, canEdit: true, canView: true };
  }
  if (role === "editor") {
    return { canAdmin: false, canEdit: true, canView: true };
  }
  if (role === "viewer") {
    return { canAdmin: false, canEdit: false, canView: true };
  }
  return { canAdmin: false, canEdit: false, canView: false };
}

export type SharedDriveSummary = {
  id: string;
  name: string;
  role: DriveRole;
  rootFolderId: string;
};

export type SharedDriveMember = {
  id: string;
  email: string;
  userId: string | null;
  displayName: string | null;
  role: DriveRole;
  pending: boolean;
};

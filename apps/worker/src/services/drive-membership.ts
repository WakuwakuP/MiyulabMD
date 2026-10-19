import {
  type DriveRole,
  flagsForDriveRole,
  isDriveRole,
  MY_DRIVE_NAME,
  type PermissionFlags,
  type SessionUser,
} from "@miyulabmd/shared";

import { db } from "../db/client.ts";

/** Empty-path label: a shared drive's name, otherwise マイドライブ. */
export async function subjectRootLabel(
  env: Env,
  ownerId: string,
): Promise<string> {
  const row = await db(env)
    .prepare("SELECT name FROM shared_drives WHERE id = ?")
    .bind(ownerId)
    .first<{ name: string }>();
  return row?.name ?? MY_DRIVE_NAME;
}

export async function isSharedDrive(
  env: Env,
  ownerId: string,
): Promise<boolean> {
  const row = await db(env)
    .prepare("SELECT id FROM shared_drives WHERE id = ?")
    .bind(ownerId)
    .first<{ id: string }>();
  return row !== null;
}

export async function driveRoleFor(
  env: Env,
  driveId: string,
  user: SessionUser | null | undefined,
): Promise<DriveRole | null> {
  if (!user) {
    return null;
  }
  const row = await db(env)
    .prepare(
      `SELECT role FROM shared_drive_members
        WHERE drive_id = ? AND user_id = ?`,
    )
    .bind(driveId, user.id)
    .first<{ role: string }>();
  return row && isDriveRole(row.role) ? row.role : null;
}

export async function driveFlags(
  env: Env,
  driveId: string,
  user: SessionUser | null | undefined,
): Promise<PermissionFlags> {
  return flagsForDriveRole(await driveRoleFor(env, driveId, user));
}

/** The signed-in user owns this user-drive, or can change content in this shared drive. */
export async function canEditSubject(
  env: Env,
  ownerId: string,
  user: SessionUser | null | undefined,
): Promise<boolean> {
  if (!user) {
    return false;
  }
  if (user.id === ownerId) {
    return true;
  }
  const role = await driveRoleFor(env, ownerId, user);
  return role === "manager" || role === "editor";
}

export async function seesSubjectTree(
  env: Env,
  ownerId: string,
  user: SessionUser | null | undefined,
): Promise<boolean> {
  if (!user) {
    return false;
  }
  if (user.id === ownerId) {
    return true;
  }
  return (await driveRoleFor(env, ownerId, user)) !== null;
}

export async function claimDriveMemberships(
  env: Env,
  userId: string,
  email: string,
): Promise<void> {
  try {
    await db(env)
      .prepare(
        `UPDATE shared_drive_members
            SET user_id = ?
          WHERE user_id IS NULL AND email = ?`,
      )
      .bind(userId, email)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("no such table")) {
      return;
    }
    throw error;
  }
}

export async function markDriveFolderKinds(
  env: Env,
  ownerId: string,
): Promise<void> {
  if (!(await isSharedDrive(env, ownerId))) {
    return;
  }
  await db(env)
    .prepare(
      `UPDATE folders SET owner_kind = 'shared_drive' WHERE owner_id = ?`,
    )
    .bind(ownerId)
    .run();
}

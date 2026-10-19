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

async function readMemberRole(
  env: Env,
  driveId: string,
  userId: string,
): Promise<DriveRole | null> {
  const row = await db(env)
    .prepare(
      `SELECT role FROM shared_drive_members
        WHERE drive_id = ? AND user_id = ?`,
    )
    .bind(driveId, userId)
    .first<{ role: string }>();
  return row && isDriveRole(row.role) ? row.role : null;
}

export async function driveRoleFor(
  env: Env,
  driveId: string,
  user: SessionUser | null | undefined,
): Promise<DriveRole | null> {
  if (!user) {
    return null;
  }
  const role = await readMemberRole(env, driveId, user.id);
  if (role || !(await isSharedDrive(env, driveId))) {
    return role;
  }
  await claimDriveMemberships(env, user.id, user.email);
  return readMemberRole(env, driveId, user.id);
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

function missingTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return message.includes("no such table");
}

/** The host after @, lowercased. Subdomains stay distinct. */
function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) {
    return null;
  }
  return email.slice(at + 1).toLowerCase();
}

async function bindPendingInvites(
  env: Env,
  userId: string,
  email: string,
): Promise<boolean> {
  try {
    await db(env)
      .prepare(
        `UPDATE shared_drive_members
            SET user_id = ?
          WHERE user_id IS NULL AND email = ?`,
      )
      .bind(userId, email)
      .run();
    return true;
  } catch (error) {
    if (missingTable(error)) {
      return false;
    }
    throw error;
  }
}

async function matchingDomainGrants(
  env: Env,
  domain: string,
  email: string,
): Promise<Array<{ drive_id: string; role: string }> | null> {
  try {
    const rows = await db(env)
      .prepare(
        `SELECT d.drive_id, d.role
           FROM shared_drive_domains d
          WHERE d.domain = ?
            AND NOT EXISTS (
              SELECT 1 FROM shared_drive_members m
               WHERE m.drive_id = d.drive_id AND m.email = ?
            )
            AND NOT EXISTS (
              SELECT 1 FROM shared_drive_domain_exclusions x
               WHERE x.drive_id = d.drive_id AND x.email = ?
            )`,
      )
      .bind(domain, email, email)
      .all<{ drive_id: string; role: string }>();
    return rows.results ?? [];
  } catch (error) {
    if (missingTable(error)) {
      return null;
    }
    throw error;
  }
}

async function insertDomainMember(
  env: Env,
  driveId: string,
  email: string,
  userId: string,
  role: DriveRole,
  now: number,
): Promise<void> {
  try {
    await db(env)
      .prepare(
        `INSERT INTO shared_drive_members
           (id, drive_id, email, user_id, role, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), driveId, email, userId, role, now)
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) {
      return;
    }
    throw error;
  }
}

async function grantDomainMemberships(
  env: Env,
  userId: string,
  email: string,
): Promise<void> {
  const domain = emailDomain(email);
  if (!domain) {
    return;
  }
  const rows = await matchingDomainGrants(env, domain, email);
  if (!rows) {
    return;
  }
  const now = Date.now();
  for (const row of rows) {
    if (!isDriveRole(row.role)) {
      continue;
    }
    await insertDomainMember(env, row.drive_id, email, userId, row.role, now);
  }
}

export async function claimDriveMemberships(
  env: Env,
  userId: string,
  email: string,
): Promise<void> {
  const ready = await bindPendingInvites(env, userId, email);
  if (!ready) {
    return;
  }
  await grantDomainMemberships(env, userId, email);
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

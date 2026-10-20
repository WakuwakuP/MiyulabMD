import {
  type DriveRole,
  isDriveRole,
  type SessionUser,
  type SharedDriveDomain,
  type SharedDriveMember,
  type SharedDriveSummary,
} from "@miyulabmd/shared";

import { db } from "../db/client.ts";
import { findUserByEmail } from "../db/users.ts";
import { claimDriveMemberships, driveRoleFor } from "./drive-membership.ts";
import { createNoteService } from "./notes.ts";

const NAME_MAX = 80;

export type DriveError =
  | { kind: "not_found" }
  | { kind: "denied"; status: 401 | 403 }
  | { kind: "invalid"; error: string; status: number };

type DriveOk<T> = { kind: "ok"; result: T };

function normalizeName(name: string | undefined): string | null {
  const trimmed = name?.trim() ?? "";
  if (
    !trimmed ||
    trimmed.length > NAME_MAX ||
    trimmed.includes(":") ||
    trimmed.includes("/")
  ) {
    return null;
  }
  return trimmed;
}

function normalizeEmail(email: string | undefined): string | null {
  const normalized = email?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizeDomain(value: string | undefined): string | null {
  const domain = value?.trim().toLowerCase().replace(/^@/, "") ?? "";
  if (
    domain.length > 253 ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(
      domain,
    )
  ) {
    return null;
  }
  return domain;
}

async function requireMember(
  env: Env,
  driveId: string,
  user: SessionUser | undefined,
): Promise<{ role: DriveRole } | DriveError> {
  if (!user) {
    return { kind: "denied", status: 401 };
  }
  const role = await driveRoleFor(env, driveId, user);
  if (!role) {
    return { kind: "not_found" };
  }
  return { role };
}

async function managerCount(env: Env, driveId: string): Promise<number> {
  const row = await db(env)
    .prepare(
      `SELECT COUNT(*) AS c FROM shared_drive_members
        WHERE drive_id = ? AND role = 'manager' AND user_id IS NOT NULL`,
    )
    .bind(driveId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

export async function createSharedDrive(
  env: Env,
  user: SessionUser | undefined,
  name: string | undefined,
): Promise<DriveError | DriveOk<SharedDriveSummary>> {
  if (!user) {
    return { kind: "denied", status: 401 };
  }
  const driveName = normalizeName(name);
  if (!driveName) {
    return { error: "ドライブ名が不正です", kind: "invalid", status: 400 };
  }
  const now = Date.now();
  const id = crypto.randomUUID();
  const rootFolderId = crypto.randomUUID();
  const d1 = db(env);
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO shared_drives (id, name, created_by, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(id, driveName, user.id, now),
    d1
      .prepare(
        `INSERT INTO shared_drive_members
           (id, drive_id, email, user_id, role, created_at)
         VALUES (?, ?, ?, ?, 'manager', ?)`,
      )
      .bind(crypto.randomUUID(), id, user.email, user.id, now),
    d1
      .prepare(
        `INSERT INTO folders (id, owner_id, owner_kind, folder, created_at)
         VALUES (?, ?, 'shared_drive', '', ?)`,
      )
      .bind(rootFolderId, id, now),
  ]);
  return {
    kind: "ok",
    result: { id, name: driveName, role: "manager", rootFolderId },
  };
}

export async function listSharedDrives(
  env: Env,
  user: SessionUser | undefined,
): Promise<SharedDriveSummary[]> {
  if (!user) {
    return [];
  }
  await claimDriveMemberships(env, user.id, user.email);
  const rows = await db(env)
    .prepare(
      `SELECT d.id, d.name, m.role, f.id AS root_folder_id
         FROM shared_drives d
         JOIN shared_drive_members m ON m.drive_id = d.id
         JOIN folders f
           ON f.owner_id = d.id AND f.folder = '' AND f.owner_kind = 'shared_drive'
        WHERE m.user_id = ?
        ORDER BY d.name COLLATE NOCASE, d.id`,
    )
    .bind(user.id)
    .all<{ id: string; name: string; role: string; root_folder_id: string }>();
  return (rows.results ?? []).flatMap((row) =>
    isDriveRole(row.role)
      ? [
          {
            id: row.id,
            name: row.name,
            role: row.role,
            rootFolderId: row.root_folder_id,
          },
        ]
      : [],
  );
}

export async function getSharedDrive(
  env: Env,
  driveId: string,
  user: SessionUser | undefined,
): Promise<DriveError | DriveOk<SharedDriveSummary>> {
  const member = await requireMember(env, driveId, user);
  if ("kind" in member) {
    return member;
  }
  const drives = await listSharedDrives(env, user);
  const drive = drives.find((item) => item.id === driveId);
  if (!drive) {
    return { kind: "not_found" };
  }
  return { kind: "ok", result: drive };
}

export async function renameSharedDrive(
  env: Env,
  driveId: string,
  name: string | undefined,
  user: SessionUser | undefined,
): Promise<DriveError | DriveOk<SharedDriveSummary>> {
  const member = await requireMember(env, driveId, user);
  if ("kind" in member) {
    return member;
  }
  if (member.role !== "manager") {
    return { kind: "denied", status: 403 };
  }
  const driveName = normalizeName(name);
  if (!driveName) {
    return { error: "ドライブ名が不正です", kind: "invalid", status: 400 };
  }
  await db(env)
    .prepare("UPDATE shared_drives SET name = ? WHERE id = ?")
    .bind(driveName, driveId)
    .run();
  return getSharedDrive(env, driveId, user);
}

async function deleteDriveContent(
  env: Env,
  driveId: string,
  user: SessionUser,
): Promise<DriveError | null> {
  await db(env)
    .prepare("UPDATE notes SET edit_locked = 0 WHERE owner_id = ?")
    .bind(driveId)
    .run();
  const notes = createNoteService(env);
  const rows = await db(env)
    .prepare("SELECT id FROM notes WHERE owner_id = ?")
    .bind(driveId)
    .all<{ id: string }>();
  for (const row of rows.results ?? []) {
    const removed = await notes.remove(row.id, user);
    if (removed.kind !== "ok") {
      return {
        error: "ノートを削除できませんでした",
        kind: "invalid",
        status: 409,
      };
    }
  }
  const d1 = db(env);
  await d1.batch([
    d1.prepare("DELETE FROM access_grants WHERE owner_id = ?").bind(driveId),
    d1.prepare("DELETE FROM folder_policies WHERE owner_id = ?").bind(driveId),
    d1.prepare("DELETE FROM article_sources WHERE owner_id = ?").bind(driveId),
    d1.prepare("DELETE FROM id_counters WHERE owner_id = ?").bind(driveId),
    d1.prepare("DELETE FROM para_spaces WHERE owner_id = ?").bind(driveId),
    d1
      .prepare("DELETE FROM medallion_sets WHERE owner_user_id = ?")
      .bind(driveId),
    d1.prepare("DELETE FROM folders WHERE owner_id = ?").bind(driveId),
    d1
      .prepare("DELETE FROM shared_drive_domain_exclusions WHERE drive_id = ?")
      .bind(driveId),
    d1
      .prepare("DELETE FROM shared_drive_domains WHERE drive_id = ?")
      .bind(driveId),
    d1
      .prepare("DELETE FROM shared_drive_members WHERE drive_id = ?")
      .bind(driveId),
    d1.prepare("DELETE FROM shared_drives WHERE id = ?").bind(driveId),
  ]);
  return null;
}

export async function deleteSharedDrive(
  env: Env,
  driveId: string,
  name: string | undefined,
  user: SessionUser | undefined,
): Promise<DriveError | DriveOk<{ id: string }>> {
  const member = await requireMember(env, driveId, user);
  if ("kind" in member || !user) {
    return "kind" in member ? member : { kind: "denied", status: 401 };
  }
  if (member.role !== "manager") {
    return { kind: "denied", status: 403 };
  }
  const row = await db(env)
    .prepare("SELECT name FROM shared_drives WHERE id = ?")
    .bind(driveId)
    .first<{ name: string }>();
  if (!row) {
    return { kind: "not_found" };
  }
  if (name?.trim() !== row.name) {
    return {
      error: "ドライブ名が一致しません",
      kind: "invalid",
      status: 400,
    };
  }
  const removed = await deleteDriveContent(env, driveId, user);
  if (removed) {
    return removed;
  }
  return { kind: "ok", result: { id: driveId } };
}

async function memberRows(
  env: Env,
  driveId: string,
): Promise<SharedDriveMember[]> {
  const rows = await db(env)
    .prepare(
      `SELECT m.id, m.email, m.user_id, m.role, u.display_name
         FROM shared_drive_members m
         LEFT JOIN users u ON u.id = m.user_id
        WHERE m.drive_id = ?
        ORDER BY m.role, m.email`,
    )
    .bind(driveId)
    .all<{
      id: string;
      email: string;
      user_id: string | null;
      role: string;
      display_name: string | null;
    }>();
  return (rows.results ?? []).flatMap((row) =>
    isDriveRole(row.role)
      ? [
          {
            displayName: row.display_name,
            email: row.email,
            id: row.id,
            pending: row.user_id === null,
            role: row.role,
            userId: row.user_id,
          },
        ]
      : [],
  );
}

export async function listDriveMembers(
  env: Env,
  driveId: string,
  user: SessionUser | undefined,
): Promise<DriveError | DriveOk<SharedDriveMember[]>> {
  const member = await requireMember(env, driveId, user);
  if ("kind" in member) {
    return member;
  }
  return { kind: "ok", result: await memberRows(env, driveId) };
}

export async function inviteDriveMember(
  env: Env,
  driveId: string,
  email: string | undefined,
  role: string | undefined,
  user: SessionUser | undefined,
): Promise<DriveError | DriveOk<SharedDriveMember[]>> {
  const member = await requireMember(env, driveId, user);
  if ("kind" in member) {
    return member;
  }
  if (member.role !== "manager") {
    return { kind: "denied", status: 403 };
  }
  const normalized = normalizeEmail(email);
  if (!(normalized && role && isDriveRole(role))) {
    return { error: "メールか役割が不正です", kind: "invalid", status: 400 };
  }
  const existing = await findUserByEmail(env, normalized);
  const d1 = db(env);
  try {
    await d1.batch([
      d1
        .prepare(
          `INSERT INTO shared_drive_members
             (id, drive_id, email, user_id, role, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          driveId,
          normalized,
          existing?.id ?? null,
          role,
          Date.now(),
        ),
      d1
        .prepare(
          `DELETE FROM shared_drive_domain_exclusions
            WHERE drive_id = ? AND email = ?`,
        )
        .bind(driveId, normalized),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) {
      return {
        error: "そのメールは既にメンバーです",
        kind: "invalid",
        status: 409,
      };
    }
    throw error;
  }
  return { kind: "ok", result: await memberRows(env, driveId) };
}

export async function updateDriveMemberRole(
  env: Env,
  driveId: string,
  memberId: string,
  role: string | undefined,
  user: SessionUser | undefined,
): Promise<DriveError | DriveOk<SharedDriveMember[]>> {
  const actor = await requireMember(env, driveId, user);
  if ("kind" in actor) {
    return actor;
  }
  if (actor.role !== "manager") {
    return { kind: "denied", status: 403 };
  }
  if (!(role && isDriveRole(role))) {
    return { error: "役割が不正です", kind: "invalid", status: 400 };
  }
  const target = await db(env)
    .prepare(
      `SELECT role, user_id FROM shared_drive_members
        WHERE id = ? AND drive_id = ?`,
    )
    .bind(memberId, driveId)
    .first<{ role: string; user_id: string | null }>();
  if (!target) {
    return { kind: "not_found" };
  }
  if (
    target.role === "manager" &&
    target.user_id &&
    role !== "manager" &&
    (await managerCount(env, driveId)) <= 1
  ) {
    return {
      error: "最後の管理者は降格できません",
      kind: "invalid",
      status: 409,
    };
  }
  await db(env)
    .prepare(
      "UPDATE shared_drive_members SET role = ? WHERE id = ? AND drive_id = ?",
    )
    .bind(role, memberId, driveId)
    .run();
  return { kind: "ok", result: await memberRows(env, driveId) };
}

export async function removeDriveMember(
  env: Env,
  driveId: string,
  memberId: string,
  user: SessionUser | undefined,
): Promise<DriveError | DriveOk<SharedDriveMember[]>> {
  const actor = await requireMember(env, driveId, user);
  if ("kind" in actor) {
    return actor;
  }
  if (actor.role !== "manager") {
    return { kind: "denied", status: 403 };
  }
  const target = await db(env)
    .prepare(
      `SELECT email, role, user_id FROM shared_drive_members
        WHERE id = ? AND drive_id = ?`,
    )
    .bind(memberId, driveId)
    .first<{ email: string; role: string; user_id: string | null }>();
  if (!target) {
    return { kind: "not_found" };
  }
  if (
    target.role === "manager" &&
    target.user_id &&
    (await managerCount(env, driveId)) <= 1
  ) {
    return {
      error: "最後の管理者は外せません",
      kind: "invalid",
      status: 409,
    };
  }
  const d1 = db(env);
  await d1.batch([
    d1
      .prepare("DELETE FROM shared_drive_members WHERE id = ? AND drive_id = ?")
      .bind(memberId, driveId),
    d1
      .prepare(
        `INSERT OR IGNORE INTO shared_drive_domain_exclusions (drive_id, email)
         VALUES (?, ?)`,
      )
      .bind(driveId, target.email),
  ]);
  return { kind: "ok", result: await memberRows(env, driveId) };
}

async function domainRows(
  env: Env,
  driveId: string,
): Promise<SharedDriveDomain[]> {
  const rows = await db(env)
    .prepare(
      `SELECT id, domain, role
         FROM shared_drive_domains
        WHERE drive_id = ?
        ORDER BY domain`,
    )
    .bind(driveId)
    .all<{ id: string; domain: string; role: string }>();
  return (rows.results ?? []).flatMap((row) =>
    isDriveRole(row.role)
      ? [{ domain: row.domain, id: row.id, role: row.role }]
      : [],
  );
}

async function requireManager(
  env: Env,
  driveId: string,
  user: SessionUser | undefined,
): Promise<DriveError | null> {
  const member = await requireMember(env, driveId, user);
  if ("kind" in member) {
    return member;
  }
  if (member.role !== "manager") {
    return { kind: "denied", status: 403 };
  }
  return null;
}

export async function listDriveDomains(
  env: Env,
  driveId: string,
  user: SessionUser | undefined,
): Promise<DriveError | DriveOk<SharedDriveDomain[]>> {
  const member = await requireMember(env, driveId, user);
  if ("kind" in member) {
    return member;
  }
  return { kind: "ok", result: await domainRows(env, driveId) };
}

export async function addDriveDomain(
  env: Env,
  driveId: string,
  domain: string | undefined,
  role: string | undefined,
  user: SessionUser | undefined,
): Promise<DriveError | DriveOk<SharedDriveDomain[]>> {
  const denied = await requireManager(env, driveId, user);
  if (denied) {
    return denied;
  }
  const normalized = normalizeDomain(domain);
  if (!(normalized && role && isDriveRole(role))) {
    return { error: "ドメインか役割が不正です", kind: "invalid", status: 400 };
  }
  try {
    await db(env)
      .prepare(
        `INSERT INTO shared_drive_domains (id, drive_id, domain, role, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), driveId, normalized, role, Date.now())
      .run();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("UNIQUE")) {
      return {
        error: "そのドメインは既に登録されています",
        kind: "invalid",
        status: 409,
      };
    }
    throw error;
  }
  return { kind: "ok", result: await domainRows(env, driveId) };
}

export async function updateDriveDomainRole(
  env: Env,
  driveId: string,
  domainId: string,
  role: string | undefined,
  user: SessionUser | undefined,
): Promise<DriveError | DriveOk<SharedDriveDomain[]>> {
  const denied = await requireManager(env, driveId, user);
  if (denied) {
    return denied;
  }
  if (!(role && isDriveRole(role))) {
    return { error: "役割が不正です", kind: "invalid", status: 400 };
  }
  const existing = await db(env)
    .prepare(
      "SELECT id FROM shared_drive_domains WHERE id = ? AND drive_id = ?",
    )
    .bind(domainId, driveId)
    .first<{ id: string }>();
  if (!existing) {
    return { kind: "not_found" };
  }
  await db(env)
    .prepare(
      `UPDATE shared_drive_domains
          SET role = ?
        WHERE id = ? AND drive_id = ?`,
    )
    .bind(role, domainId, driveId)
    .run();
  return { kind: "ok", result: await domainRows(env, driveId) };
}

export async function removeDriveDomain(
  env: Env,
  driveId: string,
  domainId: string,
  user: SessionUser | undefined,
): Promise<DriveError | DriveOk<SharedDriveDomain[]>> {
  const denied = await requireManager(env, driveId, user);
  if (denied) {
    return denied;
  }
  const existing = await db(env)
    .prepare(
      "SELECT id FROM shared_drive_domains WHERE id = ? AND drive_id = ?",
    )
    .bind(domainId, driveId)
    .first<{ id: string }>();
  if (!existing) {
    return { kind: "not_found" };
  }
  await db(env)
    .prepare("DELETE FROM shared_drive_domains WHERE id = ? AND drive_id = ?")
    .bind(domainId, driveId)
    .run();
  return { kind: "ok", result: await domainRows(env, driveId) };
}

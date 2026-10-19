import { env } from "cloudflare:workers";
import { Elysia } from "elysia";

import { readSession } from "../auth/session.ts";
import {
  addDriveDomain,
  createSharedDrive,
  type DriveError,
  deleteSharedDrive,
  getSharedDrive,
  inviteDriveMember,
  listDriveDomains,
  listDriveMembers,
  listSharedDrives,
  removeDriveDomain,
  removeDriveMember,
  renameSharedDrive,
  updateDriveDomainRole,
  updateDriveMemberRole,
} from "../services/shared-drives.ts";

async function parseJsonBody<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function driveError(
  set: { status?: number | string },
  result: DriveError,
): { error: string } {
  if (result.kind === "not_found") {
    set.status = 404;
    return { error: "Not found" };
  }
  if (result.kind === "denied") {
    set.status = result.status;
    return { error: result.status === 401 ? "Unauthorized" : "Forbidden" };
  }
  set.status = result.status;
  return { error: result.error };
}

export const sharedDriveRoutes = new Elysia({ prefix: "/api/drives" })
  .get("/", async ({ request }) => {
    const user = await readSession(request, env);
    return { drives: await listSharedDrives(env, user ?? undefined) };
  })
  .post("/", async ({ request, set }) => {
    const user = await readSession(request, env);
    const body = await parseJsonBody<{ name?: string }>(request);
    const created = await createSharedDrive(env, user ?? undefined, body?.name);
    if (created.kind !== "ok") {
      return driveError(set, created);
    }
    set.status = 201;
    return created.result;
  })
  .get("/:id", async ({ params, request, set }) => {
    const user = await readSession(request, env);
    const drive = await getSharedDrive(env, params.id, user ?? undefined);
    if (drive.kind !== "ok") {
      return driveError(set, drive);
    }
    return drive.result;
  })
  .patch("/:id", async ({ params, request, set }) => {
    const user = await readSession(request, env);
    const body = await parseJsonBody<{ name?: string }>(request);
    const renamed = await renameSharedDrive(
      env,
      params.id,
      body?.name,
      user ?? undefined,
    );
    if (renamed.kind !== "ok") {
      return driveError(set, renamed);
    }
    return renamed.result;
  })
  .delete("/:id", async ({ params, request, set }) => {
    const user = await readSession(request, env);
    const body = await parseJsonBody<{ name?: string }>(request);
    const deleted = await deleteSharedDrive(
      env,
      params.id,
      body?.name,
      user ?? undefined,
    );
    if (deleted.kind !== "ok") {
      return driveError(set, deleted);
    }
    return deleted.result;
  })
  .get("/:id/members", async ({ params, request, set }) => {
    const user = await readSession(request, env);
    const members = await listDriveMembers(env, params.id, user ?? undefined);
    if (members.kind !== "ok") {
      return driveError(set, members);
    }
    return { members: members.result };
  })
  .post("/:id/members", async ({ params, request, set }) => {
    const user = await readSession(request, env);
    const body = await parseJsonBody<{ email?: string; role?: string }>(
      request,
    );
    const invited = await inviteDriveMember(
      env,
      params.id,
      body?.email,
      body?.role,
      user ?? undefined,
    );
    if (invited.kind !== "ok") {
      return driveError(set, invited);
    }
    set.status = 201;
    return { members: invited.result };
  })
  .patch("/:id/members/:memberId", async ({ params, request, set }) => {
    const user = await readSession(request, env);
    const body = await parseJsonBody<{ role?: string }>(request);
    const updated = await updateDriveMemberRole(
      env,
      params.id,
      params.memberId,
      body?.role,
      user ?? undefined,
    );
    if (updated.kind !== "ok") {
      return driveError(set, updated);
    }
    return { members: updated.result };
  })
  .delete("/:id/members/:memberId", async ({ params, request, set }) => {
    const user = await readSession(request, env);
    const removed = await removeDriveMember(
      env,
      params.id,
      params.memberId,
      user ?? undefined,
    );
    if (removed.kind !== "ok") {
      return driveError(set, removed);
    }
    return { members: removed.result };
  })
  .get("/:id/domains", async ({ params, request, set }) => {
    const user = await readSession(request, env);
    const domains = await listDriveDomains(env, params.id, user ?? undefined);
    if (domains.kind !== "ok") {
      return driveError(set, domains);
    }
    return { domains: domains.result };
  })
  .post("/:id/domains", async ({ params, request, set }) => {
    const user = await readSession(request, env);
    const body = await parseJsonBody<{ domain?: string; role?: string }>(
      request,
    );
    const added = await addDriveDomain(
      env,
      params.id,
      body?.domain,
      body?.role,
      user ?? undefined,
    );
    if (added.kind !== "ok") {
      return driveError(set, added);
    }
    set.status = 201;
    return { domains: added.result };
  })
  .patch("/:id/domains/:domainId", async ({ params, request, set }) => {
    const user = await readSession(request, env);
    const body = await parseJsonBody<{ role?: string }>(request);
    const updated = await updateDriveDomainRole(
      env,
      params.id,
      params.domainId,
      body?.role,
      user ?? undefined,
    );
    if (updated.kind !== "ok") {
      return driveError(set, updated);
    }
    return { domains: updated.result };
  })
  .delete("/:id/domains/:domainId", async ({ params, request, set }) => {
    const user = await readSession(request, env);
    const removed = await removeDriveDomain(
      env,
      params.id,
      params.domainId,
      user ?? undefined,
    );
    if (removed.kind !== "ok") {
      return driveError(set, removed);
    }
    return { domains: removed.result };
  });

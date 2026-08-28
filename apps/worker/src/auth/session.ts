import type { SessionUser } from "@miyulabmd/shared";

export async function readSession(_request: Request, _env: Env): Promise<SessionUser | null> {
  return null;
}

export function sessionCookieHeader(_user: SessionUser, _env: Env): string {
  return "";
}

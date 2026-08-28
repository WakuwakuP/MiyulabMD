import type { SessionUser } from "@miyulabmd/shared";

/** Personal Access Token (Bearer) を SHA-256 照合する。MCP / 自動化用。 */
export async function authenticateBearer(
  _request: Request,
  _env: Env,
): Promise<SessionUser | null> {
  return null;
}

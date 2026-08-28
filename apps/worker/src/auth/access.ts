import type { SessionUser } from "@miyulabmd/shared";

/** Cloudflare Access JWT を検証し、email を取り出す。実装はフェーズ 1。 */
export async function verifyAccessJwt(
  _request: Request,
  _env: Env,
): Promise<SessionUser | null> {
  return null;
}

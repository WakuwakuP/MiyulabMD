import type { SessionUser } from "@miyulabmd/shared";

const CLIENT_WS_IDENTITY_HEADERS = [
  "X-User-Id",
  "X-User-Email",
  "X-Display-Name",
  "X-Note-Id",
  "X-Can-Edit",
] as const;

type NoteWsAccess = {
  id: string;
  editLocked: boolean;
  access: { flags: { canEdit: boolean } };
};

/**
 * DocumentRoom へ渡す WS ヘッダ。握手に必要な Upgrade 等は残し、
 * identity / ACL はクライアント値を捨ててサーバ側だけで付け直す。
 */
export function documentRoomWsHeaders(
  request: Request,
  note: NoteWsAccess,
  user: SessionUser | null,
): Headers {
  const headers = new Headers(request.headers);
  for (const name of CLIENT_WS_IDENTITY_HEADERS) {
    headers.delete(name);
  }
  headers.set("X-Note-Id", note.id);
  headers.set(
    "X-Can-Edit",
    note.access.flags.canEdit && !note.editLocked ? "true" : "false",
  );
  if (user) {
    headers.set("X-User-Id", user.id);
    headers.set("X-User-Email", user.email);
    if (user.displayName) {
      headers.set("X-Display-Name", user.displayName);
    }
  }
  return headers;
}

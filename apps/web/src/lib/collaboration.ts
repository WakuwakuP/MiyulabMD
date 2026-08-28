/** Yjs provider。DocumentRoom の WebSocket に接続する。実装はフェーズ 2。 */
export function collaborationUrl(noteId: string): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/notes/${noteId}`;
}

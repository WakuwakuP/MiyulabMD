const OFFLOAD_TOOLS = new Set([
  "get_note",
  "grep_notes",
  "list_folder_entries",
  "list_notes",
  "search_notes",
]);

export const OFFLOAD_BODY_LIMIT = 8192;

/**
 * tools/call のうち Worker で結果 JSON を組み直すと 10ms を超えるもの。
 * ヘッダと本文のツール名が食い違うときは SDK に戻す。
 */
export function offloadToolName(raw: string, headers: Headers): string | null {
  if (new TextEncoder().encode(raw).byteLength > OFFLOAD_BODY_LIMIT) {
    return null;
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (record.jsonrpc !== "2.0" || record.method !== "tools/call") {
    return null;
  }
  if (!("id" in record)) {
    return null;
  }
  const params = record.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  const name = (params as Record<string, unknown>).name;
  if (typeof name !== "string" || !OFFLOAD_TOOLS.has(name)) {
    return null;
  }
  const methodHeader = headers.get("Mcp-Method")?.trim();
  if (methodHeader && methodHeader !== "tools/call") {
    return null;
  }
  const nameHeader = headers.get("Mcp-Name")?.trim();
  if (nameHeader && nameHeader !== name) {
    return null;
  }
  return name;
}

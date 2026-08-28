/**
 * MCP 2026-07-28 stateless Streamable HTTP。
 * Agents SDK の createMcpHandler を呼び、Elysia ルートから Request を渡す。
 */
export async function handleMcp(_request: Request): Promise<Response> {
  return new Response("MCP endpoint is not implemented yet", { status: 501 });
}

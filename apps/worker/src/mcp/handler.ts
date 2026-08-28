import { createMcpHandler } from "agents/mcp/server";
import { env } from "cloudflare:workers";

import { authenticateBearer } from "../auth/tokens.ts";
import { createMcpServerFactory } from "./tools.ts";

const mcpHandler = createMcpHandler(createMcpServerFactory, {
  route: "/mcp",
});

type McpExecutionContext = ExecutionContext & {
  props?: { user: Awaited<ReturnType<typeof authenticateBearer>> };
};

/**
 * MCP 2026-07-28 stateless Streamable HTTP。
 * Agents SDK の createMcpHandler を呼び、Elysia ルートから Request を渡す。
 */
export async function handleMcp(request: Request): Promise<Response> {
  const user = await authenticateBearer(request, env);
  if (!user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ctx = { props: { user } } as McpExecutionContext;
  return mcpHandler(request, env, ctx);
}

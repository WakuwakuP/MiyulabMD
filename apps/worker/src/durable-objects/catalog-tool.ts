import type { SessionUser } from "@miyulabmd/shared";

import { runReadTool } from "../mcp/read-tools.ts";
import { toolDefinitions } from "../mcp/tool-definitions.ts";
import { readCatalogUser } from "./catalog-list.ts";

type ToolCall = {
  arguments: unknown;
  id: unknown;
  name: string;
};

type SchemaResult =
  | { issues: readonly { message?: string }[] }
  | { value: unknown };

const MCP_CORS: Record<string, string> = {
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, mcp-session-id, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "mcp-session-id",
  "Access-Control-Max-Age": "86400",
};

function toolFrame(
  id: unknown,
  result: { content: { text: string; type: "text" }[]; isError?: true },
): Response {
  const message = JSON.stringify({
    id: id ?? null,
    jsonrpc: "2.0",
    result,
  });
  return new Response(`event: message\ndata: ${message}\n\n`, {
    headers: {
      ...MCP_CORS,
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
    status: 200,
  });
}

function textError(message: string) {
  return {
    content: [{ text: message, type: "text" as const }],
    isError: true as const,
  };
}

function readToolCall(body: unknown): ToolCall | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (record.method !== "tools/call" || !("id" in record)) {
    return null;
  }
  const params = record.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return null;
  }
  const name = (params as Record<string, unknown>).name;
  if (typeof name !== "string") {
    return null;
  }
  return {
    arguments: (params as Record<string, unknown>).arguments,
    id: record.id,
    name,
  };
}

async function validateArgs(
  name: string,
  args: unknown,
): Promise<{ value: Record<string, unknown> } | { error: string }> {
  const definition = toolDefinitions[name as keyof typeof toolDefinitions];
  if (!definition) {
    return { error: "Not found" };
  }
  const schema = definition.inputSchema as {
    "~standard": {
      validate: (value: unknown) => Promise<SchemaResult> | SchemaResult;
    };
  };
  const parsed = await schema["~standard"].validate(args ?? {});
  if ("issues" in parsed) {
    const detail = parsed.issues
      .map((issue) => issue.message ?? "invalid")
      .join("; ");
    return {
      error: `Input validation error: Invalid arguments for tool ${name}: ${detail}`,
    };
  }
  if (!parsed.value || typeof parsed.value !== "object") {
    return { value: {} };
  }
  return { value: parsed.value as Record<string, unknown> };
}

function logTiming(tool: string, started: number, outcome: string) {
  console.log(
    JSON.stringify({
      durationMs: Date.now() - started,
      event: "mcp_tool_timing",
      outcome,
      tool,
    }),
  );
}

async function runCall(
  env: Env,
  user: SessionUser,
  call: ToolCall,
): Promise<Response> {
  const started = Date.now();
  const validated = await validateArgs(call.name, call.arguments);
  if ("error" in validated) {
    logTiming(call.name, started, "tool_error");
    return toolFrame(call.id, textError(validated.error));
  }
  try {
    const result = await runReadTool(env, user, call.name, validated.value);
    logTiming(call.name, started, result.isError ? "tool_error" : "ok");
    return toolFrame(call.id, result);
  } catch (error) {
    logTiming(call.name, started, "exception");
    const message = error instanceof Error ? error.message : "Invalid request";
    return toolFrame(call.id, textError(message));
  }
}

/** MCP の読み取りツール。JSON-RPC の SSE をここで組み、Worker は転送だけする。 */
export async function handleCatalogTool(
  env: Env,
  request: Request,
): Promise<Response> {
  const user = readCatalogUser(request);
  if (user === "invalid") {
    return toolFrame(null, textError("invalid user"));
  }
  if (!user) {
    return toolFrame(null, textError("Unauthorized"));
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return toolFrame(null, textError("Parse error"));
  }
  const call = readToolCall(body);
  if (!call) {
    return toolFrame(null, textError("Invalid request"));
  }
  return runCall(env, user, call);
}

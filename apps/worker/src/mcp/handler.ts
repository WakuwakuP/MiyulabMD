import { env } from "cloudflare:workers";
import { createMcpHandler } from "agents/mcp/server";

import { wwwAuthenticate } from "../auth/oauth-policy.ts";
import { authenticateBearer } from "../auth/tokens.ts";
import {
  catalogObjectName,
  catalogToolRequest,
} from "../durable-objects/catalog-list.ts";
import { OFFLOAD_BODY_LIMIT, offloadToolName } from "./offload-classify.ts";
import { createMcpServerFactory } from "./tools.ts";

const mcpHandler = createMcpHandler(createMcpServerFactory, {
  route: "/mcp",
});

type McpExecutionContext = ExecutionContext & {
  props?: { user: Awaited<ReturnType<typeof authenticateBearer>> };
};

function replay(request: Request, raw: string): Request {
  const headers = new Headers(request.headers);
  headers.set(
    "content-length",
    String(new TextEncoder().encode(raw).byteLength),
  );
  return new Request(request, { body: raw, headers });
}

async function bufferedBody(
  request: Request,
): Promise<{ overflow: boolean; raw: string }> {
  const reader = request.body?.getReader();
  if (!reader) {
    return { overflow: false, raw: "" };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  let overflow = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    size += value.byteLength;
    if (size > OFFLOAD_BODY_LIMIT) {
      overflow = true;
    }
  }
  const raw = new TextDecoder().decode(concatChunks(chunks));
  return { overflow, raw };
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * 重い読み取りは CatalogRoom が組んだ SSE をそのまま返す。
 * それ以外は本文を戻して SDK に渡す。
 */
async function dispatchReadTool(
  request: Request,
  user: NonNullable<Awaited<ReturnType<typeof authenticateBearer>>>,
): Promise<Response | Request> {
  if (request.method !== "POST") {
    return request;
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return request;
  }
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > OFFLOAD_BODY_LIMIT) {
    return request;
  }
  const buffered = await bufferedBody(request);
  if (buffered.overflow || !offloadToolName(buffered.raw, request.headers)) {
    return replay(request, buffered.raw);
  }
  return env.CATALOG.get(env.CATALOG.idFromName(catalogObjectName(user))).fetch(
    catalogToolRequest(user, buffered.raw),
  );
}

/**
 * MCP 2026-07-28 stateless Streamable HTTP。
 * Agents SDK の createMcpHandler を呼び、Elysia ルートから Request を渡す。
 */
export async function handleMcp(request: Request): Promise<Response> {
  const user = await authenticateBearer(request, env);
  if (!user) {
    const origin = new URL(request.url).origin;
    const invalidToken = Boolean(
      request.headers.get("Authorization")?.startsWith("Bearer "),
    );
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": wwwAuthenticate(origin, invalidToken),
      },
      status: 401,
    });
  }

  const dispatched = await dispatchReadTool(request, user);
  if (dispatched instanceof Response) {
    return dispatched;
  }

  const ctx = { props: { user } } as McpExecutionContext;
  return mcpHandler(dispatched, env, ctx);
}

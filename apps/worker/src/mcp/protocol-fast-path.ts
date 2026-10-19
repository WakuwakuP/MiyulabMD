import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/server";

import { listToolsForFeatures } from "./tool-catalog.ts";

const FIRST_MODERN_PROTOCOL_VERSION = "2026-07-28";
const PROTOCOL_VERSION_META_KEY = "io.modelcontextprotocol/protocolVersion";

const LEGACY_PROTOCOL_VERSIONS = SUPPORTED_PROTOCOL_VERSIONS.filter(
  (version) => version < FIRST_MODERN_PROTOCOL_VERSION,
);
const PREFERRED_PROTOCOL_VERSION = LEGACY_PROTOCOL_VERSIONS[0] ?? "2025-11-25";

const SERVER_INFO = { name: "miyulabmd", version: "0.1.0" } as const;
const CAPABILITIES = { tools: { listChanged: true } } as const;

const CORS = {
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, mcp-session-id, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "mcp-session-id",
  "Access-Control-Max-Age": "86400",
};

const NOT_ACCEPTABLE =
  "Not Acceptable: Client must accept both application/json and text/event-stream";

type FeatureFlag = "hasMedallion" | "hasPara" | "hasSchemes";

export type McpFeatureFlags = Record<FeatureFlag, boolean>;

export type FastMcpDecision =
  | { kind: "passthrough" }
  | { kind: "response"; response: Response }
  | { id: string | number; kind: "tools-list" };

/**
 * initialize / ping / notifications / tools/list は SDK のサーバー構築だけで
 * Worker CPU が 10ms を超える。妥当な本文だけここで返し、検証に落ちるものは
 * SDK に戻す。
 */
export function decideFastMcp(raw: string, headers: Headers): FastMcpDecision {
  if (modernProtocol(headers)) {
    return { kind: "passthrough" };
  }
  const body = parseMessage(raw);
  if (!body) {
    return { kind: "passthrough" };
  }
  return decideMessage(body, headers);
}

export function toolsListResponse(
  id: string | number,
  features: McpFeatureFlags,
): Response {
  return rpcResult(id, { tools: listToolsForFeatures(features) });
}

function decideMessage(
  body: Record<string, unknown>,
  headers: Headers,
): FastMcpDecision {
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return { kind: "passthrough" };
  }
  const handled = handledResponse(body);
  if (!handled) {
    return { kind: "passthrough" };
  }
  if (!acceptable(headers)) {
    return {
      kind: "response",
      response: jsonError(406, -32000, NOT_ACCEPTABLE),
    };
  }
  const unsupported = unsupportedProtocol(headers);
  if (unsupported) {
    return { kind: "response", response: unsupported };
  }
  return handled;
}

function handledResponse(
  body: Record<string, unknown>,
): FastMcpDecision | null {
  if (typeof body.method !== "string" || hasModernClaim(body.params)) {
    return null;
  }
  if (!("id" in body)) {
    const notification = notificationResponse(body.method, body.params);
    return notification ? { kind: "response", response: notification } : null;
  }
  const id = requestId(body.id);
  if (id === null) {
    return null;
  }
  return requestResponse(body.method, body.params, id);
}

function requestResponse(
  method: string,
  params: unknown,
  id: string | number,
): FastMcpDecision | null {
  if (method === "ping") {
    return isMetaObject(params)
      ? { kind: "response", response: rpcResult(id, {}) }
      : null;
  }
  if (method === "initialize") {
    const result = initializeResult(params);
    return result
      ? { kind: "response", response: rpcResult(id, result) }
      : null;
  }
  if (method === "tools/list" && isToolsListParams(params)) {
    return { id, kind: "tools-list" };
  }
  return null;
}

function notificationResponse(
  method: string,
  params: unknown,
): Response | null {
  if (method === "notifications/initialized" && isMetaObject(params)) {
    return accepted();
  }
  if (method === "notifications/cancelled" && isCancelled(params)) {
    return accepted();
  }
  if (method === "notifications/progress" && isProgress(params)) {
    return accepted();
  }
  return null;
}

function initializeResult(params: unknown): {
  capabilities: typeof CAPABILITIES;
  protocolVersion: string;
  serverInfo: typeof SERVER_INFO;
} | null {
  if (!isRecord(params)) {
    return null;
  }
  if (typeof params.protocolVersion !== "string") {
    return null;
  }
  if (params.protocolVersion >= FIRST_MODERN_PROTOCOL_VERSION) {
    return null;
  }
  if (!(isRecord(params.capabilities) && isClientInfo(params.clientInfo))) {
    return null;
  }
  const protocolVersion = LEGACY_PROTOCOL_VERSIONS.includes(
    params.protocolVersion,
  )
    ? params.protocolVersion
    : PREFERRED_PROTOCOL_VERSION;
  return {
    capabilities: CAPABILITIES,
    protocolVersion,
    serverInfo: SERVER_INFO,
  };
}

function isClientInfo(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  if (typeof value.name !== "string" || typeof value.version !== "string") {
    return false;
  }
  if ("title" in value && typeof value.title !== "string") {
    return false;
  }
  if ("websiteUrl" in value && typeof value.websiteUrl !== "string") {
    return false;
  }
  if ("description" in value && typeof value.description !== "string") {
    return false;
  }
  return !("icons" in value && !Array.isArray(value.icons));
}

function isToolsListParams(params: unknown): boolean {
  if (params === undefined) {
    return true;
  }
  if (!isRecord(params)) {
    return false;
  }
  return !("cursor" in params && typeof params.cursor !== "string");
}

function isCancelled(params: unknown): boolean {
  if (!isRecord(params)) {
    return false;
  }
  if (
    "requestId" in params &&
    requestId(params.requestId) === null &&
    params.requestId !== undefined
  ) {
    return false;
  }
  return !("reason" in params && typeof params.reason !== "string");
}

function isProgress(params: unknown): boolean {
  if (!isRecord(params) || typeof params.progress !== "number") {
    return false;
  }
  if (!isProgressToken(params.progressToken)) {
    return false;
  }
  if ("total" in params && typeof params.total !== "number") {
    return false;
  }
  return !("message" in params && typeof params.message !== "string");
}

function isProgressToken(value: unknown): boolean {
  return typeof value === "string" || requestId(value) !== null;
}

function isMetaObject(params: unknown): boolean {
  return params === undefined || isRecord(params);
}

function hasModernClaim(params: unknown): boolean {
  if (!isRecord(params)) {
    return false;
  }
  if (
    typeof params.protocolVersion === "string" &&
    params.protocolVersion >= FIRST_MODERN_PROTOCOL_VERSION
  ) {
    return true;
  }
  const meta = params._meta;
  return isRecord(meta) && PROTOCOL_VERSION_META_KEY in meta;
}

function modernProtocol(headers: Headers): boolean {
  const version = headers.get("mcp-protocol-version")?.trim() ?? "";
  return version >= FIRST_MODERN_PROTOCOL_VERSION;
}

function unsupportedProtocol(headers: Headers): Response | null {
  const version = headers.get("mcp-protocol-version")?.trim();
  if (!version || SUPPORTED_PROTOCOL_VERSIONS.includes(version)) {
    return null;
  }
  const supported = SUPPORTED_PROTOCOL_VERSIONS.join(", ");
  return jsonError(
    400,
    -32000,
    `Bad Request: Unsupported protocol version: ${version} (supported versions: ${supported})`,
  );
}

function acceptable(headers: Headers): boolean {
  const accept = headers.get("accept") ?? "";
  return (
    accept.includes("application/json") && accept.includes("text/event-stream")
  );
}

function parseMessage(raw: string): Record<string, unknown> | null {
  try {
    const body: unknown = JSON.parse(raw);
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

function requestId(value: unknown): string | number | null {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rpcResult(id: string | number, result: unknown): Response {
  const message = JSON.stringify({ id, jsonrpc: "2.0", result });
  return new Response(`event: message\ndata: ${message}\n\n`, {
    headers: {
      ...CORS,
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    },
    status: 200,
  });
}

function accepted(): Response {
  return new Response(null, { headers: CORS, status: 202 });
}

function jsonError(status: number, code: number, message: string): Response {
  return Response.json(
    { error: { code, message }, id: null, jsonrpc: "2.0" },
    { headers: CORS, status },
  );
}

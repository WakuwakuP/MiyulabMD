import type { McpRequestContext } from "@modelcontextprotocol/server";

const BOOTSTRAP_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
]);

type RequestTarget =
  | { kind: "bootstrap" }
  | { kind: "tool"; name: string }
  | null;

/**
 * Classification only: the SDK still validates and handles the request.
 * Never consume the SDK's original body, or inspect large tool payloads just
 * to optimize a small request. Unknown lengths/methods use the full factory.
 */
export async function getMcpRequestTarget(
  context?: McpRequestContext,
): Promise<RequestTarget> {
  const request = context?.requestInfo;
  if (request?.method !== "POST") {
    return null;
  }
  if (context?.era === "modern") {
    // The SDK validates modern Mcp-Method/Mcp-Name against the envelope
    // before constructing the server. Modern bodies may already be consumed.
    const method = request.headers.get("Mcp-Method")?.trim();
    if (method === "ping") {
      return { kind: "bootstrap" };
    }
    const name = request.headers.get("Mcp-Name")?.trim();
    return method === "tools/call" && name ? { kind: "tool", name } : null;
  }
  const length = request.headers.get("Content-Length");
  if (!(length && /^\d+$/.test(length)) || Number(length) > 2048) {
    return null;
  }
  try {
    return legacyTarget(await request.clone().json());
  } catch {
    return null;
  }
}

function legacyTarget(body: unknown): RequestTarget {
  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    !("jsonrpc" in body) ||
    body.jsonrpc !== "2.0" ||
    !("method" in body) ||
    typeof body.method !== "string"
  ) {
    return null;
  }
  if (BOOTSTRAP_METHODS.has(body.method)) {
    return { kind: "bootstrap" };
  }
  if (body.method === "tools/call" && "params" in body) {
    const params = body.params;
    if (
      typeof params === "object" &&
      params !== null &&
      !Array.isArray(params) &&
      "name" in params &&
      typeof params.name === "string"
    ) {
      return { kind: "tool", name: params.name };
    }
  }
  return null;
}

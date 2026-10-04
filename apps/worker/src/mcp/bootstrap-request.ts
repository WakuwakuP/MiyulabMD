import type { McpRequestContext } from "@modelcontextprotocol/server";

const BOOTSTRAP_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
]);

/**
 * Classification only: the SDK still validates and handles the request.
 * Never consume the SDK's original body, or inspect large tool payloads just
 * to optimize a small handshake. Unknown lengths/methods use the full factory.
 */
export async function isBootstrapRequest(context?: McpRequestContext) {
  const request = context?.requestInfo;
  if (request?.method !== "POST") {
    return false;
  }
  if (context?.era === "modern") {
    // The SDK validates modern Mcp-Method against the JSON-RPC envelope
    // before constructing the server. Modern bodies may already be consumed.
    return request.headers.get("Mcp-Method")?.trim() === "ping";
  }
  const length = request.headers.get("Content-Length");
  if (!(length && /^\d+$/.test(length)) || Number(length) > 2048) {
    return false;
  }
  try {
    const body: unknown = await request.clone().json();
    return (
      typeof body === "object" &&
      body !== null &&
      !Array.isArray(body) &&
      "jsonrpc" in body &&
      body.jsonrpc === "2.0" &&
      "method" in body &&
      typeof body.method === "string" &&
      BOOTSTRAP_METHODS.has(body.method)
    );
  } catch {
    return false;
  }
}

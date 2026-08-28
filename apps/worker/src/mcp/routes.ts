import { Elysia } from "elysia";
import { handleMcp } from "./handler.ts";

/** Streamable HTTP は GET / POST 両方を使う。本体は createMcpHandler。 */
export const mcpRoutes = new Elysia({ prefix: "/mcp" })
  .all("/", ({ request }) => handleMcp(request))
  .all("/*", ({ request }) => handleMcp(request));

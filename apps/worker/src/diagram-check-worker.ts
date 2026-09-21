import {
  type DiagramCheckBlock,
  validateDiagramBlocks,
} from "./diagram-check/validate.ts";

/**
 * Binding-only Worker that syntax-checks mermaid/PlantUML diagram blocks on
 * behalf of the main worker's MCP write tools. The engines are far too heavy
 * for the app worker bundle (~6 MiB compressed), so they live here behind a
 * service binding — the same pattern as miyulabmd-og-fetch.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("POST only", { status: 405 });
    }
    let blocks: unknown;
    try {
      blocks = ((await request.json()) as { blocks?: unknown })?.blocks;
    } catch {
      return new Response("invalid json", { status: 400 });
    }
    if (!Array.isArray(blocks)) {
      return new Response("blocks array required", { status: 400 });
    }
    const clean = blocks.filter(
      (b): b is DiagramCheckBlock =>
        typeof b === "object" &&
        b !== null &&
        (b.language === "mermaid" || b.language === "plantuml") &&
        typeof b.source === "string" &&
        typeof b.line === "number",
    );
    const result = await validateDiagramBlocks(clean);
    return Response.json(result);
  },
};

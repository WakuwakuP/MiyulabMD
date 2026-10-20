import { DurableObject } from "cloudflare:workers";
import {
  type DiagramCheckBlock,
  validateDiagramBlocks,
} from "./diagram-check/validate.ts";

type DiagramCheckEnv = {
  DIAGRAM_CHECK_ROOM: DurableObjectNamespace<DiagramCheckRoom>;
};

// Stream the body through: JSON parsing and engine CPU belong to the DO.
export default {
  fetch(request: Request, env: DiagramCheckEnv): Promise<Response> {
    const id = env.DIAGRAM_CHECK_ROOM.newUniqueId();
    return env.DIAGRAM_CHECK_ROOM.get(id).fetch(request);
  },
};

// Each check gets its own object so unrelated notes never queue behind it.
export class DiagramCheckRoom extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
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
  }
}

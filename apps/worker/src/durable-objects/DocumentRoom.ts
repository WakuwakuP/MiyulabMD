/**
 * ノート 1 件につき 1 Durable Object。
 * Yjs 同期・awareness・SQLite 永続化・MCP からの applyMarkdown を担う。
 */
export class DocumentRoom {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(_request: Request): Promise<Response> {
    return new Response("DocumentRoom is not implemented yet", { status: 501 });
  }

  async applyMarkdown(_markdown: string): Promise<void> {
    throw new Error("not implemented");
  }

  async getMarkdown(): Promise<string> {
    return "";
  }
}

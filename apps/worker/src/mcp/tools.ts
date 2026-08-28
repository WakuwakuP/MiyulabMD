import { MCP_TOOLS } from "@miyulabmd/shared";

export const mcpToolNames = MCP_TOOLS;

/** createMcpHandler に渡すツール定義。実装はフェーズ 4。 */
export function createMcpTools(_env: Env) {
  return mcpToolNames;
}

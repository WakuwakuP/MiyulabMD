export const MCP_TOOLS = [
  "list_notes",
  "get_note",
  "create_note",
  "update_note",
  "delete_note",
  "set_note_permission",
  "invite_collaborator",
  "search_notes",
] as const;

export type McpToolName = (typeof MCP_TOOLS)[number];

export const MCP_TOOLS = [
  "list_notes",
  "get_note",
  "create_note",
  "replace_in_note",
  "insert_in_note",
  "update_note",
  "delete_note",
  "set_note_access",
  "invite_collaborator",
  "search_notes",
  "agent_join",
  "agent_leave",
  "list_note_history",
  "get_revision",
  "restore_revision",
] as const;

export type McpToolName = (typeof MCP_TOOLS)[number];

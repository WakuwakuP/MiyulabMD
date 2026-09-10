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

/** list_notes / get_note / create_note の description に付ける。結果に url は載せない。 */
export const MCP_NOTE_URL_HINT =
  "Note page URL is /n/{id} using the UUID id. Do not use /{shortId}. Origin is the same host as this MCP endpoint.";

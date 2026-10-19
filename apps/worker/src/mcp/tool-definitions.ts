import {
  ACCESS_SCOPES,
  MCP_DIAGRAM_CHECK_HINT,
  MCP_NOTE_URL_HINT,
} from "@miyulabmd/shared";
import { z } from "zod";
import { toolInputSchema } from "./tool-input-schema.ts";

// Only immutable tool metadata is shared across requests. Each request still
// gets its own McpServer, user-specific feature gates, and tool handlers.
export const toolDefinitions = {
  agent_join: {
    description:
      "Show an AI(username) cursor on an open note. The name is the token owner's display name. Edit and get_note tools join automatically.",
    inputSchema: toolInputSchema({
      id: z.string().describe("Note UUID or short ID"),
    }),
  },
  agent_leave: {
    description: "Hide the AI(username) cursor on a note.",
    inputSchema: toolInputSchema({
      id: z.string().describe("Note UUID or short ID"),
    }),
  },
  create_note: {
    description: `Create a new note owned by the authenticated user. ${MCP_NOTE_URL_HINT} ${MCP_DIAGRAM_CHECK_HINT}`,
    inputSchema: toolInputSchema({
      folder: z.string().optional(),
      inheritAccess: z.boolean().optional(),
      markdown: z.string().optional(),
      readScope: z.enum(ACCESS_SCOPES).optional(),
      title: z.string().optional(),
      writeScope: z.enum(ACCESS_SCOPES).optional(),
    }),
  },
  delete_folder: {
    description:
      "Delete ONE empty folder only (0 notes, 0 subfolders, 0 article sources in its subtree). Non-empty folders are rejected with counts; nothing is deleted partially. Set dry_run first and use expected_path to guard against moves or renames. Protected folders (drive root, PARA buckets/space roots, scheme roots, configured protected folders) cannot be deleted. Do not issue repeated bulk deletion calls. On resource-limit / 503: do not retry the same call.",
    inputSchema: toolInputSchema({
      dry_run: z
        .boolean()
        .optional()
        .describe("Report the folder and metadata to remove without writing"),
      expected_path: z
        .string()
        .optional()
        .describe(
          "Guard: the folder's current path must exactly equal this, otherwise reject",
        ),
      folder_id: z
        .string()
        .optional()
        .describe("Folder UUID to delete (preferred)"),
      path: z
        .string()
        .optional()
        .describe(
          "Alternative to folder_id: a folder path in your own drive. Must resolve to one folder; if both are supplied they must agree",
        ),
    }),
  },
  delete_note: {
    description:
      "Delete a note (requires canAdmin). Call once per note; do not burst-delete. If a resource-limit error is returned, wait a few seconds before the next delete.",
    inputSchema: toolInputSchema({
      id: z.string().describe("Note UUID or short ID"),
    }),
  },
  get_note: {
    description: `Get note metadata and the live collaborative markdown (not a stale D1 snapshot). Shows an AI(username) cursor to people editing in the browser. Includes a heading outline. ${MCP_NOTE_URL_HINT}`,
    inputSchema: toolInputSchema({
      id: z.string().describe("Note UUID or short ID"),
      numbered: z
        .boolean()
        .optional()
        .describe("Prefix each markdown line with its 1-based line number"),
    }),
  },
  get_revision: {
    description: "Get the markdown stored for a note revision.",
    inputSchema: toolInputSchema({
      id: z.string().describe("Note UUID or short ID"),
      revisionId: z.string().describe("Revision UUID"),
    }),
  },
  grep_notes: {
    description: `Line-level search over the markdown body of accessible notes — like grep. Returns 1-based line/column plus context lines so results can feed replace_in_note. Reads the D1 markdown snapshot which lags live edits by a few seconds; check snapshot_updated_at per match. pattern is a fixed string by default; set fixed_string=false for a JS regular expression. ${MCP_NOTE_URL_HINT}`,
    inputSchema: toolInputSchema({
      case_sensitive: z
        .boolean()
        .optional()
        .describe("Match case (default: false)"),
      context_after: z
        .number()
        .int()
        .min(0)
        .max(5)
        .optional()
        .describe("Lines of context after each hit (default 1, max 5)"),
      context_before: z
        .number()
        .int()
        .min(0)
        .max(5)
        .optional()
        .describe("Lines of context before each hit (default 1, max 5)"),
      fixed_string: z
        .boolean()
        .optional()
        .describe(
          "Treat pattern as a literal string (default: true). Set false for a JS regex.",
        ),
      folder_id: z
        .string()
        .optional()
        .describe("Restrict to notes inside this folder UUID (recursive)"),
      glob_title: z
        .string()
        .optional()
        .describe("Only scan notes whose title matches this glob (* ?)"),
      max_matches_per_note: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Cap hits per note (default 10, max 50)"),
      max_notes: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Cap notes with hits (default 50, max 200)"),
      pattern: z
        .string()
        .min(1)
        .max(500)
        .describe("Text or regex to find in note bodies"),
      scheme_id: z
        .string()
        .optional()
        .describe(
          "Restrict to the folder carrying this naming-scheme ID (e.g. `15.22`); alternative to folder_id",
        ),
    }),
  },
  insert_in_note: {
    description: `Insert text into the live note. Provide exactly one of: at (start|end), after (unique context), or before (unique context). Prefer unique surrounding text when editing the middle. Shows an AI(username) cursor at the insert. ${MCP_DIAGRAM_CHECK_HINT}`,
    inputSchema: toolInputSchema({
      after: z
        .string()
        .optional()
        .describe("Insert immediately after this unique text"),
      at: z.enum(["start", "end"]).optional(),
      before: z
        .string()
        .optional()
        .describe("Insert immediately before this unique text"),
      id: z.string().describe("Note UUID or short ID"),
      text: z.string().describe("Text to insert, including any newlines"),
    }),
  },
  invite_collaborator: {
    description: "Grant a user read or write access to a note by email.",
    inputSchema: toolInputSchema({
      canWrite: z.boolean().optional(),
      email: z.string().email(),
      id: z.string().describe("Note UUID or short ID"),
    }),
  },
  jd_allocate_id: {
    description:
      "Allocate the next Johnny.Decimal ID under a JD folder without creating anything. Under a JD root returns an area ('10-19'), under an area a category ('15'), under a category an ID ('15.22'). Category-local max+1 — gaps are never reused and .00–.10 stay reserved. Errors once a category reaches 100 IDs.",
    inputSchema: toolInputSchema({
      folder_id: z.string().describe("JD root, area, or category folder UUID"),
    }),
  },
  jd_create_id_folder: {
    description:
      "Allocate a Johnny.Decimal ID and create the child folder ('15.22 Title') under a JD root/area/category. title defaults to 無題 — rename later. Pass scheme_id to claim a specific number instead of the next one.",
    inputSchema: toolInputSchema({
      folder_id: z.string().describe("JD root, area, or category folder UUID"),
      scheme_id: z
        .string()
        .optional()
        .describe(
          "Explicit ID ('10-19' / '15' / '15.22') instead of auto-allocation",
        ),
      title: z
        .string()
        .optional()
        .describe("Title after the ID (default 無題)"),
    }),
  },
  jd_get: {
    description:
      "Resolve a Johnny.Decimal ID such as '15.22' to its folder and list the direct children. Same resolution as scheme_get but JD-only.",
    inputSchema: toolInputSchema({
      id: z.string().describe("JD ID such as '10-19', '15', or '15.22'"),
    }),
  },
  jd_list_category: {
    description:
      "List a JD container's numbered children in numeric order — areas under a JD root, categories under an area, IDs under a category.",
    inputSchema: toolInputSchema({
      folder_id: z.string().describe("JD root, area, or category folder UUID"),
    }),
  },
  jd_validate_tree: {
    description:
      "Validate the caller's naming-scheme tree: JD area/category/ID counts, naming-pattern deviations ('15.22 Title'), duplicate IDs, reserved .00–.10 usage, and IDs moved outside their expected parent. Returns a structured issue list.",
    inputSchema: toolInputSchema({}),
  },
  list_backlinks: {
    description: `List notes linking to the given note (incoming links). Only sources the caller can see are listed. ${MCP_NOTE_URL_HINT}`,
    inputSchema: toolInputSchema({
      id: z.string().describe("Note UUID or short ID"),
    }),
  },
  list_broken_links: {
    description:
      "List unresolved links (missing or ambiguous) across notes the caller can see. Use before renaming or promoting notes.",
    inputSchema: toolInputSchema({}),
  },
  list_folder_entries: {
    description: `List direct children (subfolders and notes) of a folder — one level only. Do not recurse; call again on a child folder_id. If the call fails with a resource-limit error, do not retry immediately. ${MCP_NOTE_URL_HINT}`,
    inputSchema: toolInputSchema({
      cursor: z
        .string()
        .optional()
        .describe("Pagination cursor from a previous nextCursor"),
      folder_id: z
        .string()
        .optional()
        .describe("Folder UUID; omit for the drive root"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max entries to return (default 50, max 200)"),
    }),
  },
  list_note_history: {
    description:
      "List edit events for a note, newest first. Use before (created_at) to page.",
    inputSchema: toolInputSchema({
      before: z
        .number()
        .optional()
        .describe("Return events created before this epoch millisecond"),
      id: z.string().describe("Note UUID or short ID"),
      limit: z.number().optional().describe("Page size (default 30)"),
    }),
  },
  list_note_links: {
    description: `List outgoing links from a note ([[wiki links]] and /n/{id} markdown links). Unresolved links have note=null. Only notes the caller can see are resolved; hidden targets look missing. ${MCP_NOTE_URL_HINT}`,
    inputSchema: toolInputSchema({
      id: z.string().describe("Note UUID or short ID"),
    }),
  },
  list_notes: {
    description: `List notes owned by or shared with the authenticated user. Do not enumerate everything — browse folders with list_folder_entries first. ${MCP_NOTE_URL_HINT}`,
    inputSchema: toolInputSchema({
      folder_id: z
        .string()
        .optional()
        .describe("Restrict to notes inside this folder UUID"),
      query: z
        .string()
        .optional()
        .describe("Optional title filter (case-insensitive substring)"),
      recursive: z
        .boolean()
        .optional()
        .describe(
          "With folder_id, include notes in descendant folders (default: direct children only)",
        ),
      scheme_id: z
        .string()
        .optional()
        .describe(
          "Restrict to the folder carrying this naming-scheme ID (e.g. `15.22`, `202609171230`); alternative to folder_id",
        ),
    }),
  },
  medallion_assign_folder: {
    description:
      "Assign a medallion set layer to a folder. Descendant folders and their notes inherit the nearest assigned ancestor's layer. One assignment per folder; reassigning overwrites it.",
    inputSchema: toolInputSchema({
      folder_id: z.string().describe("Folder UUID"),
      layer: z.string().describe("Layer key inside the set (e.g. 'output')"),
      set_id: z.string().describe("Medallion set UUID"),
    }),
  },
  medallion_list_sets: {
    description:
      "List the caller's medallion layer sets (name + ordered key/label layers) and the folders assigned to them. Medallion layers are folder-level display labels — they do not affect editability (see set_edit_lock).",
    inputSchema: toolInputSchema({}),
  },
  medallion_unassign_folder: {
    description:
      "Clear a folder's medallion assignment. Descendants then inherit from the next assigned ancestor (or none).",
    inputSchema: toolInputSchema({
      folder_id: z.string().describe("Folder UUID"),
    }),
  },
  move_folder: {
    description:
      "Move a folder (with all contents) under another folder, or to the drive root. Detects cycles, conflicts, and the 500-item cap. Set dry_run first to preview counts. On resource-limit / 503: do not retry the same call; wait a few seconds and move a shallower child instead.",
    inputSchema: toolInputSchema({
      dest_folder_id: z
        .string()
        .nullable()
        .optional()
        .describe("Destination folder UUID; null/omitted = drive root"),
      dry_run: z
        .boolean()
        .optional()
        .describe("Report planned counts without writing"),
      folder_id: z.string().describe("Folder UUID to move"),
      name: z.string().optional().describe("Rename the folder while moving"),
    }),
  },
  move_folder_contents: {
    description:
      "Move the direct notes (and optionally direct subfolders with their subtrees) of a folder into another folder. The source folder itself stays. Set dry_run first. Prefer include_subfolders=false for large trees. On resource-limit / 503: do not retry the same call.",
    inputSchema: toolInputSchema({
      dest_folder_id: z
        .string()
        .nullable()
        .optional()
        .describe("Destination folder UUID; null/omitted = drive root"),
      dry_run: z
        .boolean()
        .optional()
        .describe("Report planned moves without writing"),
      folder_id: z.string().describe("Source folder UUID"),
      include_subfolders: z
        .boolean()
        .optional()
        .describe("Also move direct child folders (default false)"),
    }),
  },
  move_notes: {
    description:
      "Move notes (by UUID or short ID) into a folder in the caller's own drive. Returns per-note moved/skipped/failed with reasons. Max 500 IDs per call. Set dry_run first. On resource-limit / 503: do not retry the same call.",
    inputSchema: toolInputSchema({
      dry_run: z
        .boolean()
        .optional()
        .describe("Report planned moves without writing"),
      folder_id: z
        .string()
        .nullable()
        .optional()
        .describe("Destination folder UUID; null/omitted = drive root"),
      note_ids: z
        .array(z.string())
        .min(1)
        .describe("Note UUIDs or short IDs to move"),
    }),
  },
  para_archive_project: {
    description:
      "Move a folder inside the Projects bucket into Archives. dated adds a YYYY-MM- prefix to the name. Set dry_run first. On resource-limit / 503: do not retry the same call; wait and archive a shallower folder.",
    inputSchema: toolInputSchema({
      dated: z
        .boolean()
        .optional()
        .describe("Prefix the archived name with YYYY-MM-"),
      dry_run: z
        .boolean()
        .optional()
        .describe("Report planned counts without writing"),
      folder_id: z.string().describe("Folder UUID inside the Projects bucket"),
      name: z.string().optional().describe("Override the archived folder name"),
    }),
  },
  para_list: {
    description:
      "List the caller's PARA spaces with their buckets (Projects/Areas/Resources/Archives). Buckets keep stable keys across renames. With bucket, also returns the direct children (e.g. active projects).",
    inputSchema: toolInputSchema({
      bucket: z
        .enum(["projects", "areas", "resources", "archives"])
        .optional()
        .describe("Return direct children of this bucket too"),
      space: z
        .string()
        .optional()
        .describe(
          "PARA space name or id; 'default' = the rootless space. Omit = all spaces; bucket children resolve in the default space unless space is given.",
        ),
    }),
  },
  replace_in_note: {
    description: `Replace a unique old_string with new_string in the live note. If old_string matches more than once and replace_all is not true, the call fails. Prefer this over update_note. Shows an AI(username) cursor at the edit. ${MCP_DIAGRAM_CHECK_HINT}`,
    inputSchema: toolInputSchema({
      id: z.string().describe("Note UUID or short ID"),
      new_string: z.string().describe("Replacement text"),
      old_string: z
        .string()
        .describe("Exact text to find. Include unique surrounding context."),
      replace_all: z
        .boolean()
        .optional()
        .describe("Replace every non-overlapping match"),
    }),
  },
  resolve_wikilink: {
    description: `Resolve a [[wiki link]] target to a note the caller can see. Order: UUID → short_id → alias → folder/Title → same-folder title → global title. Pass context_id to scope folder-relative resolution to that note's folder. ${MCP_NOTE_URL_HINT}`,
    inputSchema: toolInputSchema({
      context_id: z
        .string()
        .optional()
        .describe(
          "Source note UUID or short ID; scopes folder/title resolution",
        ),
      target: z.string().min(1).describe("The link target text inside [[...]]"),
    }),
  },
  restore_revision: {
    description: `Replace the live note with a stored revision. Concurrent edits are overwritten. Requires canEdit. ${MCP_DIAGRAM_CHECK_HINT}`,
    inputSchema: toolInputSchema({
      id: z.string().describe("Note UUID or short ID"),
      revisionId: z.string().describe("Revision UUID to restore"),
    }),
  },
  scheme_get: {
    description:
      "Resolve a naming-scheme ID (e.g. '15.22' or '202609171230') to the folder that carries it in the caller's own drive, and list its direct children.",
    inputSchema: toolInputSchema({
      id: z.string().describe("Scheme ID such as '15.22' or '202609171230'"),
    }),
  },
  search_notes: {
    description:
      'Search accessible notes by title or markdown snapshot. Query supports a small DSL: `word`, `"exact phrase"`, `-excluded`, and filters `path:folder`, `tag:name`, `layer:key` or `layer:set.key` (folder medallion assignment, inherited by descendants), `scheme:`/`jd:15.22`, `para:projects`. Use scope=title for fast title-only lookup; use grep_notes for line-level body hits.',
    inputSchema: toolInputSchema({
      cursor: z
        .string()
        .optional()
        .describe("Pagination cursor from a previous next_cursor"),
      folder_id: z
        .string()
        .optional()
        .describe("Restrict to notes inside this folder UUID (recursive)"),
      layer: z
        .string()
        .optional()
        .describe(
          "Restrict to a medallion layer — a layer key (`output`) or set-qualified (`set.key`)",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max notes to return (default 50, max 200)"),
      query: z.string().describe("Search query"),
      scheme_id: z
        .string()
        .optional()
        .describe(
          "Restrict to the folder carrying this naming-scheme ID (e.g. `15.22`); alternative to folder_id",
        ),
      scope: z
        .enum(["title", "body", "all"])
        .optional()
        .describe("Where to match (default: all)"),
    }),
  },
  set_edit_lock: {
    description:
      "Lock or unlock a note for editing. While locked every mutation — body edits, metadata, folder move, delete, sharing — is rejected until explicit unlock (locked=false). There is no timed unlock. Requires canAdmin. Unlocking (locked=false) additionally requires confirm=true.",
    inputSchema: toolInputSchema({
      confirm: z
        .boolean()
        .optional()
        .describe(
          "Must be true when locked=false (unlock is gated like promote_note's confirm)",
        ),
      id: z.string().describe("Note UUID or short ID"),
      locked: z.boolean().describe("true to lock (read-only), false to unlock"),
    }),
  },
  set_folder_scheme: {
    description:
      "Opt-in naming rule for a folder's future children. 'jd' = Johnny.Decimal (10 areas / 10 categories / 100 IDs), 'zettel' = Zettelkasten UTC timestamp IDs (YYYYMMDDHHmm). Existing children keep their names — the scheme only affects new creates. Pass null to clear. Owner only.",
    inputSchema: toolInputSchema({
      folder_id: z
        .string()
        .describe("Folder UUID that declares the naming rule"),
      scheme: z
        .enum(["jd", "zettel"])
        .nullable()
        .describe("Naming rule to apply, or null to clear"),
    }),
  },
  set_note_access: {
    description:
      "Change note read/write access (requires owner). inheritAccess follows the folder policy.",
    inputSchema: toolInputSchema({
      id: z.string().describe("Note UUID or short ID"),
      inheritAccess: z.boolean().optional(),
      readScope: z.enum(ACCESS_SCOPES).optional(),
      writeScope: z.enum(ACCESS_SCOPES).optional(),
    }),
  },
  update_note: {
    description: `Last-resort full replace of the live note markdown. Concurrent human edits may be disrupted. Prefer replace_in_note or insert_in_note. Shows an AI(username) cursor. ${MCP_DIAGRAM_CHECK_HINT}`,
    inputSchema: toolInputSchema({
      id: z.string().describe("Note UUID or short ID"),
      markdown: z.string().describe("Full markdown body"),
    }),
  },
};

import { env } from "cloudflare:workers";
import {
  ACCESS_SCOPES,
  NOTE_RESTORE_MESSAGE,
  type Note,
  type SessionUser,
} from "@miyulabmd/shared";
import { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";

import type { ApplyEditResult } from "../durable-objects/DocumentRoom.ts";
import { actorFromSessionUser } from "../durable-objects/history-edit.ts";
import {
  type InsertPosition,
  markdownOutline,
  numberMarkdownLines,
} from "../durable-objects/markdown-edit.ts";
import { getNoteRevision, listNoteEditEvents } from "../services/history.ts";
import {
  createNoteService,
  type GetNoteResult,
  type MutateNoteResult,
} from "../services/notes.ts";

function textResult(data: unknown) {
  return {
    content: [{ text: JSON.stringify(data, null, 2), type: "text" as const }],
  };
}

function textError(message: string) {
  return {
    content: [{ text: message, type: "text" as const }],
    isError: true as const,
  };
}

function requireUser(): SessionUser | null {
  const raw = getMcpAuthContext()?.props.user;
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.email !== "string") {
    return null;
  }

  return {
    displayName:
      typeof candidate.displayName === "string" ? candidate.displayName : null,
    email: candidate.email,
    id: candidate.id,
  };
}

function documentRoom(noteId: string) {
  return env.DOCUMENT_ROOM.get(env.DOCUMENT_ROOM.idFromName(noteId));
}

function agentOf(user: SessionUser) {
  return {
    displayName: user.displayName?.trim() || user.email,
    userId: user.id,
  };
}

function editToolResult(noteId: string, result: ApplyEditResult) {
  if (!result.ok) {
    const suffix =
      result.matches === undefined ? "" : ` (matches: ${result.matches})`;
    return textError(`${result.message}${suffix}`);
  }
  return textResult({
    applied: true,
    cursor: result.cursor,
    excerpt: result.excerpt,
    id: noteId,
    markdownLength: result.markdownLength,
  });
}

function getNoteToolError(result: GetNoteResult) {
  if (result.kind === "not_found") {
    return textError("Not found");
  }
  if (result.kind === "denied") {
    return textError(result.status === 401 ? "Unauthorized" : "Forbidden");
  }
  return null;
}

function mutateNoteToolResponse(result: MutateNoteResult) {
  if (result.kind === "not_found") {
    return textError("Not found");
  }
  if (result.kind === "denied") {
    return textError(result.status === 401 ? "Unauthorized" : "Forbidden");
  }
  if (result.kind === "bad_request") {
    return textError(result.error);
  }
  return textResult({ note: result.note });
}

function resolveInsertPosition(
  at: "start" | "end" | undefined,
  after: string | undefined,
  before: string | undefined,
): InsertPosition | { error: string } {
  const specified = [at !== undefined, Boolean(after), Boolean(before)].filter(
    Boolean,
  ).length;
  if (specified !== 1) {
    return { error: "Provide exactly one of: at, after, before" };
  }
  if (at !== undefined) {
    return { at };
  }
  if (after) {
    return { after };
  }
  if (before) {
    return { before };
  }
  return { error: "Provide exactly one of: at, after, before" };
}

type ToolTextResult =
  | ReturnType<typeof textResult>
  | ReturnType<typeof textError>;

async function requireViewableNote(
  notes: ReturnType<typeof createNoteService>,
  id: string,
  user: SessionUser,
): Promise<{ ok: true; note: Note } | { ok: false; error: ToolTextResult }> {
  const loaded = await notes.get(id, user);
  const error = getNoteToolError(loaded);
  if (error) {
    return { error, ok: false };
  }
  if (loaded.kind !== "ok") {
    return { error: textError("Not found"), ok: false };
  }
  return { note: loaded.note, ok: true };
}

async function requireEditableNote(
  notes: ReturnType<typeof createNoteService>,
  id: string,
  user: SessionUser,
): Promise<{ ok: true; note: Note } | { ok: false; error: ToolTextResult }> {
  const loaded = await requireViewableNote(notes, id, user);
  if (!loaded.ok) {
    return loaded;
  }
  if (!loaded.note.access.flags.canEdit) {
    return { error: textError("Forbidden"), ok: false };
  }
  return loaded;
}

function grantsWithCollaborator(
  grants: Note["access"]["grants"],
  email: string,
  canWrite: boolean | undefined,
) {
  const next = grants
    .filter((grant) => grant.email !== email.trim().toLowerCase())
    .map((grant) => ({ canWrite: grant.canWrite, email: grant.email }));
  next.push({ canWrite: Boolean(canWrite), email });
  return next;
}

async function insertInNoteTool(
  notes: ReturnType<typeof createNoteService>,
  input: {
    id: string;
    text: string;
    at?: "start" | "end";
    after?: string;
    before?: string;
  },
): Promise<ToolTextResult> {
  const user = requireUser();
  if (!user) {
    return textError("Unauthorized");
  }

  const position = resolveInsertPosition(input.at, input.after, input.before);
  if ("error" in position) {
    return textError(position.error);
  }

  const loaded = await requireEditableNote(notes, input.id, user);
  if (!loaded.ok) {
    return loaded.error;
  }

  const result = await documentRoom(loaded.note.id).applyEdit({
    agent: agentOf(user),
    noteId: loaded.note.id,
    op: "insert",
    position,
    text: input.text,
  });
  return editToolResult(loaded.note.id, result);
}

async function listNoteHistoryTool(
  notes: ReturnType<typeof createNoteService>,
  input: { id: string; limit?: number; before?: number },
): Promise<ToolTextResult> {
  const user = requireUser();
  if (!user) {
    return textError("Unauthorized");
  }

  const loaded = await requireViewableNote(notes, input.id, user);
  if (!loaded.ok) {
    return loaded.error;
  }

  const page = await listNoteEditEvents(env, loaded.note.id, {
    before: input.before,
    limit: input.limit,
  });
  return textResult(page);
}

async function getRevisionTool(
  notes: ReturnType<typeof createNoteService>,
  input: { id: string; revisionId: string },
): Promise<ToolTextResult> {
  const user = requireUser();
  if (!user) {
    return textError("Unauthorized");
  }

  const loaded = await requireViewableNote(notes, input.id, user);
  if (!loaded.ok) {
    return loaded.error;
  }

  const revision = await getNoteRevision(env, loaded.note.id, input.revisionId);
  if (!revision) {
    return textError("Not found");
  }
  return textResult(revision);
}

async function restoreRevisionTool(
  notes: ReturnType<typeof createNoteService>,
  input: { id: string; revisionId: string },
): Promise<ToolTextResult> {
  const user = requireUser();
  if (!user) {
    return textError("Unauthorized");
  }

  const loaded = await requireEditableNote(notes, input.id, user);
  if (!loaded.ok) {
    return loaded.error;
  }

  const revision = await getNoteRevision(env, loaded.note.id, input.revisionId);
  if (!revision) {
    return textError("Not found");
  }

  const applied = await documentRoom(loaded.note.id).restoreMarkdown(
    loaded.note.id,
    revision.markdown,
    actorFromSessionUser(user),
  );
  if (!applied.ok) {
    return textError(applied.message);
  }

  return textResult({
    message: NOTE_RESTORE_MESSAGE,
    restored: true,
    revisionId: revision.id,
  });
}

async function inviteCollaboratorTool(
  notes: ReturnType<typeof createNoteService>,
  input: { id: string; email: string; canWrite?: boolean },
): Promise<ToolTextResult> {
  const user = requireUser();
  if (!user) {
    return textError("Unauthorized");
  }

  const current = await notes.get(input.id, user);
  const currentError = getNoteToolError(current);
  if (currentError) {
    return currentError;
  }
  if (current.kind !== "ok") {
    return textError("Not found");
  }

  const result = await notes.updateMeta(input.id, user, {
    grants: grantsWithCollaborator(
      current.note.access.grants,
      input.email,
      input.canWrite,
    ),
    inheritAccess: current.note.access.inherit,
    readScope: current.note.access.inherit
      ? undefined
      : current.note.access.effectiveReadScope,
    writeScope: current.note.access.inherit
      ? undefined
      : current.note.access.effectiveWriteScope,
  });
  return mutateNoteToolResponse(result);
}

/** createMcpHandler に渡す MCP サーバーファクトリ。 */
export function createMcpServerFactory() {
  const server = new McpServer({
    name: "miyulabmd",
    version: "0.1.0",
  });
  const notes = createNoteService(env);

  server.registerTool(
    "list_notes",
    {
      description: "List notes owned by or shared with the authenticated user.",
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe("Optional title filter (case-insensitive substring)"),
      },
    },
    async ({ query }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }

      let list = await notes.listForUser(user);
      const trimmedQuery = query?.trim();
      if (trimmedQuery) {
        const needle = trimmedQuery.toLowerCase();
        list = list.filter((note) => note.title.toLowerCase().includes(needle));
      }

      return textResult({ notes: list });
    },
  );

  server.registerTool(
    "get_note",
    {
      description:
        "Get note metadata and the live collaborative markdown (not a stale D1 snapshot). Shows an AI(username) cursor to people editing in the browser. Includes a heading outline.",
      inputSchema: {
        id: z.string().describe("Note UUID or short ID"),
        numbered: z
          .boolean()
          .optional()
          .describe("Prefix each markdown line with its 1-based line number"),
      },
    },
    async ({ id, numbered }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }

      const result = await notes.get(id, user);
      if (result.kind === "not_found") {
        return textError("Not found");
      }
      if (result.kind === "denied") {
        return textError(result.status === 401 ? "Unauthorized" : "Forbidden");
      }

      const note = result.note;
      const markdown = await documentRoom(note.id).readForAgent(
        note.id,
        agentOf(user),
      );
      const live = { ...note, markdown };

      return textResult({
        note: live,
        outline: markdownOutline(markdown),
        ...(numbered
          ? { numberedMarkdown: numberMarkdownLines(markdown) }
          : {}),
      });
    },
  );

  server.registerTool(
    "create_note",
    {
      description: "Create a new note owned by the authenticated user.",
      inputSchema: {
        folder: z.string().optional(),
        inheritAccess: z.boolean().optional(),
        markdown: z.string().optional(),
        readScope: z.enum(ACCESS_SCOPES).optional(),
        title: z.string().optional(),
        writeScope: z.enum(ACCESS_SCOPES).optional(),
      },
    },
    async ({
      title,
      markdown,
      folder,
      inheritAccess,
      readScope,
      writeScope,
    }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }

      const created = await notes.create(user, {
        folder,
        inheritAccess,
        markdown,
        readScope,
        title,
        writeScope,
      });
      if ("error" in created) {
        return textError(created.error);
      }

      return textResult({ note: created });
    },
  );

  server.registerTool(
    "replace_in_note",
    {
      description:
        "Replace a unique old_string with new_string in the live note. If old_string matches more than once and replace_all is not true, the call fails. Prefer this over update_note. Shows an AI(username) cursor at the edit.",
      inputSchema: {
        id: z.string().describe("Note UUID or short ID"),
        new_string: z.string().describe("Replacement text"),
        old_string: z
          .string()
          .describe("Exact text to find. Include unique surrounding context."),
        replace_all: z
          .boolean()
          .optional()
          .describe("Replace every non-overlapping match"),
      },
    },
    async ({ id, old_string, new_string, replace_all }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }

      const loaded = await notes.get(id, user);
      if (loaded.kind === "not_found") {
        return textError("Not found");
      }
      if (loaded.kind === "denied") {
        return textError(loaded.status === 401 ? "Unauthorized" : "Forbidden");
      }
      if (!loaded.note.access.flags.canEdit) {
        return textError("Forbidden");
      }

      const result = await documentRoom(loaded.note.id).applyEdit({
        agent: agentOf(user),
        newString: new_string,
        noteId: loaded.note.id,
        oldString: old_string,
        op: "replace",
        replaceAll: replace_all,
      });
      return editToolResult(loaded.note.id, result);
    },
  );

  server.registerTool(
    "insert_in_note",
    {
      description:
        "Insert text into the live note. Provide exactly one of: at (start|end), after (unique context), or before (unique context). Prefer unique surrounding text when editing the middle. Shows an AI(username) cursor at the insert.",
      inputSchema: {
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
      },
    },
    async ({ id, text, at, after, before }) =>
      insertInNoteTool(notes, { after, at, before, id, text }),
  );

  server.registerTool(
    "update_note",
    {
      description:
        "Last-resort full replace of the live note markdown. Concurrent human edits may be disrupted. Prefer replace_in_note or insert_in_note. Shows an AI(username) cursor.",
      inputSchema: {
        id: z.string().describe("Note UUID or short ID"),
        markdown: z.string().describe("Full markdown body"),
      },
    },
    async ({ id, markdown }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }

      const result = await notes.get(id, user);
      if (result.kind === "not_found") {
        return textError("Not found");
      }
      if (result.kind === "denied") {
        return textError(result.status === 401 ? "Unauthorized" : "Forbidden");
      }

      const note = result.note;
      if (!note.access.flags.canEdit) {
        return textError("Forbidden");
      }

      const applied = await documentRoom(note.id).applyEdit({
        agent: agentOf(user),
        markdown,
        noteId: note.id,
        op: "set",
      });
      if (!applied.ok) {
        return textError(applied.message);
      }

      return textResult({
        applied: true,
        cursor: applied.cursor,
        excerpt: applied.excerpt,
        id: note.id,
        markdownLength: applied.markdownLength,
        shortId: note.shortId,
        title: note.title,
      });
    },
  );

  server.registerTool(
    "delete_note",
    {
      description: "Delete a note (requires canAdmin).",
      inputSchema: {
        id: z.string().describe("Note UUID or short ID"),
      },
    },
    async ({ id }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }

      const result = await notes.remove(id, user);
      if (result.kind === "not_found") {
        return textError("Not found");
      }
      if (result.kind === "denied") {
        return textError(result.status === 401 ? "Unauthorized" : "Forbidden");
      }
      if (result.kind !== "ok") {
        return textError("Failed to delete note");
      }

      return textResult({ deleted: true, id: result.note.id });
    },
  );

  server.registerTool(
    "set_note_access",
    {
      description:
        "Change note read/write access (requires owner). inheritAccess follows the folder policy.",
      inputSchema: {
        id: z.string().describe("Note UUID or short ID"),
        inheritAccess: z.boolean().optional(),
        readScope: z.enum(ACCESS_SCOPES).optional(),
        writeScope: z.enum(ACCESS_SCOPES).optional(),
      },
    },
    async ({ id, inheritAccess, readScope, writeScope }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }

      const result = await notes.updateMeta(id, user, {
        inheritAccess,
        readScope,
        writeScope,
      });
      if (result.kind === "not_found") {
        return textError("Not found");
      }
      if (result.kind === "denied") {
        return textError(result.status === 401 ? "Unauthorized" : "Forbidden");
      }
      if (result.kind === "bad_request") {
        return textError(result.error);
      }

      return textResult({ note: result.note });
    },
  );

  server.registerTool(
    "invite_collaborator",
    {
      description: "Grant a user read or write access to a note by email.",
      inputSchema: {
        canWrite: z.boolean().optional(),
        email: z.string().email(),
        id: z.string().describe("Note UUID or short ID"),
      },
    },
    async ({ id, email, canWrite }) =>
      inviteCollaboratorTool(notes, { canWrite, email, id }),
  );

  server.registerTool(
    "search_notes",
    {
      description:
        "Search accessible notes by title or markdown snapshot substring.",
      inputSchema: {
        query: z.string().describe("Search query"),
      },
    },
    async ({ query }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }

      const trimmedQuery = query.trim();
      if (!trimmedQuery) {
        return textError("query is required");
      }

      const notesFound = await notes.searchForUser(user, trimmedQuery);
      return textResult({ notes: notesFound, query: trimmedQuery });
    },
  );

  server.registerTool(
    "agent_join",
    {
      description:
        "Show an AI(username) cursor on an open note. The name is the token owner's display name. Edit and get_note tools join automatically.",
      inputSchema: {
        id: z.string().describe("Note UUID or short ID"),
      },
    },
    async ({ id }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }

      const result = await notes.get(id, user);
      if (result.kind === "not_found") {
        return textError("Not found");
      }
      if (result.kind === "denied") {
        return textError(result.status === 401 ? "Unauthorized" : "Forbidden");
      }

      await documentRoom(result.note.id).setAgentPresence(
        result.note.id,
        agentOf(user),
      );
      return textResult({ id: result.note.id, joined: true });
    },
  );

  server.registerTool(
    "agent_leave",
    {
      description: "Hide the AI(username) cursor on a note.",
      inputSchema: {
        id: z.string().describe("Note UUID or short ID"),
      },
    },
    async ({ id }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }

      const result = await notes.get(id, user);
      if (result.kind === "not_found") {
        return textError("Not found");
      }
      if (result.kind === "denied") {
        return textError(result.status === 401 ? "Unauthorized" : "Forbidden");
      }

      await documentRoom(result.note.id).clearAgentPresence();
      return textResult({ id: result.note.id, left: true });
    },
  );

  server.registerTool(
    "list_note_history",
    {
      description:
        "List edit events for a note, newest first. Use before (created_at) to page.",
      inputSchema: {
        before: z
          .number()
          .optional()
          .describe("Return events created before this epoch millisecond"),
        id: z.string().describe("Note UUID or short ID"),
        limit: z.number().optional().describe("Page size (default 30)"),
      },
    },
    async ({ id, limit, before }) =>
      listNoteHistoryTool(notes, { before, id, limit }),
  );

  server.registerTool(
    "get_revision",
    {
      description: "Get the markdown stored for a note revision.",
      inputSchema: {
        id: z.string().describe("Note UUID or short ID"),
        revisionId: z.string().describe("Revision UUID"),
      },
    },
    async ({ id, revisionId }) => getRevisionTool(notes, { id, revisionId }),
  );

  server.registerTool(
    "restore_revision",
    {
      description:
        "Replace the live note with a stored revision. Concurrent edits are overwritten. Requires canEdit.",
      inputSchema: {
        id: z.string().describe("Note UUID or short ID"),
        revisionId: z.string().describe("Revision UUID to restore"),
      },
    },
    async ({ id, revisionId }) =>
      restoreRevisionTool(notes, { id, revisionId }),
  );

  return server;
}

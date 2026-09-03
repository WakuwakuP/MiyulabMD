import { env } from "cloudflare:workers";
import { ACCESS_SCOPES, type SessionUser } from "@miyulabmd/shared";
import { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";

import type { ApplyEditResult } from "../durable-objects/DocumentRoom.ts";
import {
  markdownOutline,
  numberMarkdownLines,
} from "../durable-objects/markdown-edit.ts";
import { createNoteService } from "../services/notes.ts";

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function textError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
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
    id: candidate.id,
    email: candidate.email,
    displayName:
      candidate.displayName === null
        ? null
        : typeof candidate.displayName === "string"
          ? candidate.displayName
          : null,
  };
}

function documentRoom(noteId: string) {
  return env.DOCUMENT_ROOM.get(env.DOCUMENT_ROOM.idFromName(noteId));
}

function agentOf(user: SessionUser) {
  return {
    userId: user.id,
    displayName: user.displayName?.trim() || user.email,
  };
}

function editToolResult(noteId: string, result: ApplyEditResult) {
  if (!result.ok) {
    const suffix =
      result.matches !== undefined ? ` (matches: ${result.matches})` : "";
    return textError(`${result.message}${suffix}`);
  }
  return textResult({
    id: noteId,
    applied: true,
    cursor: result.cursor,
    excerpt: result.excerpt,
    markdownLength: result.markdownLength,
  });
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
        title: z.string().optional(),
        markdown: z.string().optional(),
        folder: z.string().optional(),
        inheritAccess: z.boolean().optional(),
        readScope: z.enum(ACCESS_SCOPES).optional(),
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
        title,
        markdown,
        folder,
        inheritAccess,
        readScope,
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
        old_string: z
          .string()
          .describe("Exact text to find. Include unique surrounding context."),
        new_string: z.string().describe("Replacement text"),
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
        noteId: loaded.note.id,
        agent: agentOf(user),
        op: "replace",
        oldString: old_string,
        newString: new_string,
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
        id: z.string().describe("Note UUID or short ID"),
        text: z.string().describe("Text to insert, including any newlines"),
        at: z.enum(["start", "end"]).optional(),
        after: z
          .string()
          .optional()
          .describe("Insert immediately after this unique text"),
        before: z
          .string()
          .optional()
          .describe("Insert immediately before this unique text"),
      },
    },
    async ({ id, text, at, after, before }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }

      const specified = [
        at !== undefined,
        Boolean(after),
        Boolean(before),
      ].filter(Boolean).length;
      if (specified !== 1) {
        return textError("Provide exactly one of: at, after, before");
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

      const position = at ? { at } : after ? { after } : { before: before! };

      const result = await documentRoom(loaded.note.id).applyEdit({
        noteId: loaded.note.id,
        agent: agentOf(user),
        op: "insert",
        text,
        position,
      });
      return editToolResult(loaded.note.id, result);
    },
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
        noteId: note.id,
        agent: agentOf(user),
        op: "set",
        markdown,
      });
      if (!applied.ok) {
        return textError(applied.message);
      }

      return textResult({
        id: note.id,
        shortId: note.shortId,
        title: note.title,
        applied: true,
        cursor: applied.cursor,
        excerpt: applied.excerpt,
        markdownLength: applied.markdownLength,
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
        id: z.string().describe("Note UUID or short ID"),
        email: z.string().email(),
        canWrite: z.boolean().optional(),
      },
    },
    async ({ id, email, canWrite }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }

      const current = await notes.get(id, user);
      if (current.kind === "not_found") {
        return textError("Not found");
      }
      if (current.kind === "denied") {
        return textError(current.status === 401 ? "Unauthorized" : "Forbidden");
      }

      const grants = current.note.access.grants
        .filter((grant) => grant.email !== email.trim().toLowerCase())
        .map((grant) => ({ email: grant.email, canWrite: grant.canWrite }));
      grants.push({ email, canWrite: Boolean(canWrite) });

      const result = await notes.updateMeta(id, user, {
        inheritAccess: current.note.access.inherit,
        readScope: current.note.access.inherit
          ? undefined
          : current.note.access.effectiveReadScope,
        writeScope: current.note.access.inherit
          ? undefined
          : current.note.access.effectiveWriteScope,
        grants,
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

  return server;
}

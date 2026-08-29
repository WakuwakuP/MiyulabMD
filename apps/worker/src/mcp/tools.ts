import { env } from "cloudflare:workers";
import { ACCESS_SCOPES, type SessionUser } from "@miyulabmd/shared";
import { McpServer } from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import { z } from "zod";

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
      description: "Get note metadata and markdown snapshot.",
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

      return textResult({ note: result.note });
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
    "update_note",
    {
      description: "Replace note markdown via DocumentRoom.applyMarkdown.",
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

      const doId = env.DOCUMENT_ROOM.idFromName(note.id);
      await env.DOCUMENT_ROOM.get(doId).applyMarkdown(markdown);

      return textResult({
        id: note.id,
        shortId: note.shortId,
        title: note.title,
        markdown,
        updated: true,
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

      const list = await notes.listForUser(user);
      const needle = trimmedQuery.toLowerCase();
      const notesFound = list.filter((note) =>
        note.title.toLowerCase().includes(needle),
      );

      return textResult({ notes: notesFound, query: trimmedQuery });
    },
  );

  return server;
}

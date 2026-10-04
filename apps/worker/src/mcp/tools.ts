import { env } from "cloudflare:workers";
import { extractDiagramBlocks } from "@miyulabmd/markdown";
import {
  EDIT_LOCKED_CODE,
  NOTE_RESTORE_MESSAGE,
  type Note,
  type SessionUser,
} from "@miyulabmd/shared";
import {
  type McpRequestContext,
  McpServer,
} from "@modelcontextprotocol/server";
import { getMcpAuthContext } from "agents/mcp/server";
import type { DiagramCheckResult } from "../diagram-check/validate.ts";
import type { ApplyEditResult } from "../durable-objects/DocumentRoom.ts";
import {
  actorFromAgent,
  actorFromSessionUser,
} from "../durable-objects/history-edit.ts";
import {
  type InsertPosition,
  markdownOutline,
  numberMarkdownLines,
} from "../durable-objects/markdown-edit.ts";
import {
  buildAccessSnapshot,
  ensureFolderRow,
  folderViewFlags,
  getFolderById,
  getFolderByPath,
  listFolderChildren,
} from "../services/access.ts";
import {
  type DeleteEmptyFolderOutcome,
  deleteEmptyFolder,
} from "../services/folder-delete.ts";
import { getNoteRevision, listNoteEditEvents } from "../services/history.ts";
import {
  listBacklinks,
  listBrokenLinks,
  listNoteLinks,
  resolveWikilink,
} from "../services/links.ts";
import {
  assignFolderMedallion,
  clearFolderMedallion,
  listMedallionAssignments,
  listMedallionSets,
  type MedallionResult,
} from "../services/medallion.ts";
import {
  type MoveError,
  moveFolder,
  moveFolderContents,
  moveNotes,
} from "../services/move.ts";
import {
  createNoteService,
  type GetNoteResult,
  type MutateNoteResult,
} from "../services/notes.ts";
import { paraArchiveProject, paraList } from "../services/para.ts";
import {
  createSchemeChild,
  folderIdsForSchemeId,
  jdAllocateId,
  jdListCategory,
  type SchemeError,
  schemeGet,
  setFolderScheme,
  validateSchemeTree,
} from "../services/schemes.ts";

import { isBootstrapRequest } from "./bootstrap-request.ts";
import { featureConfig } from "./feature-config.ts";
import { toolDefinitions } from "./tool-definitions.ts";
import { withToolTiming } from "./tool-timing.ts";

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

async function listNotesForTool(
  notes: ReturnType<typeof createNoteService>,
  user: SessionUser,
  options: {
    folderId?: string;
    query?: string;
    recursive: boolean;
  },
): Promise<
  { notes: Awaited<ReturnType<typeof notes.listForUser>> } | { error: string }
> {
  let list: Awaited<ReturnType<typeof notes.listForUser>>;
  if (options.folderId) {
    const result = await notes.listFolderNotes(
      user,
      options.folderId,
      options.recursive,
    );
    if (result.kind === "not_found") {
      return { error: "Not found" };
    }
    if (result.kind === "denied") {
      return { error: result.status === 401 ? "Unauthorized" : "Forbidden" };
    }
    list = result.notes;
  } else {
    list = await notes.listForUser(user);
  }
  const trimmedQuery = options.query?.trim();
  if (trimmedQuery) {
    const needle = trimmedQuery.toLowerCase();
    list = list.filter((note) => note.title.toLowerCase().includes(needle));
  }
  return { notes: list };
}

function medallionToolError(
  result: Exclude<MedallionResult<unknown>, { kind: "ok" }>,
) {
  if (result.kind === "not_found") {
    return textError("Not found");
  }
  if (result.kind === "denied") {
    return textError("Forbidden");
  }
  if (result.kind === "confirm_required") {
    return textError(
      `confirm_required: ${result.assignedFolders} folder(s) still reference this set`,
    );
  }
  return textError(result.message ?? "Invalid request");
}

/** Denied-result text that surfaces the §2.6 edit-lock code when present. */
function deniedToolError(result: { status: number; code?: string }) {
  if (result.code === EDIT_LOCKED_CODE) {
    return textError(
      `${EDIT_LOCKED_CODE}: this note is edit-locked. Call set_edit_lock with locked=false first.`,
    );
  }
  return textError(result.status === 401 ? "Unauthorized" : "Forbidden");
}

/** folder_id か scheme_id（`15.22` 等）から対象フォルダ UUID を決める。 */
async function folderIdArg(
  user: SessionUser,
  folderId: string | undefined,
  schemeId: string | undefined,
): Promise<{ folderId?: string } | { error: string }> {
  if (!schemeId) {
    return { folderId };
  }
  if (folderId) {
    return { error: "Specify either folder_id or scheme_id, not both" };
  }
  const resolved = await folderIdsForSchemeId(env, user.id, schemeId);
  if (resolved.length === 0) {
    return { error: "Not found" };
  }
  if (resolved.length > 1) {
    return {
      error:
        "scheme_id is ambiguous across multiple scheme roots; specify folder_id instead",
    };
  }
  return { folderId: resolved[0] };
}

const MOVE_OVERLOAD_MESSAGE =
  "Do not retry the same call. Wait a few seconds; split into shallower moves (move_folder on a direct child, or move_folder_contents without include_subfolders).";

function moveToolError(result: MoveError | SchemeError) {
  if (result.kind === "not_found") {
    return textError("Not found");
  }
  if (result.kind === "denied") {
    return textError(result.status === 401 ? "Unauthorized" : "Forbidden");
  }
  return textError(result.error);
}

async function runMoveTool<T>(
  run: () => Promise<{ kind: "ok"; result: T } | MoveError | SchemeError>,
): Promise<ToolTextResult> {
  try {
    const result = await run();
    if (result.kind !== "ok") {
      return moveToolError(result);
    }
    return textResult(result.result);
  } catch {
    return textError(MOVE_OVERLOAD_MESSAGE);
  }
}

const DELETE_FOLDER_OVERLOAD_MESSAGE =
  "Do not retry the same call. Stop bulk deletion and inspect the current folder state before deciding on a new request. Delete only one empty folder per call; do not issue repeated bulk deletion calls.";

async function runDeleteFolderTool(
  run: () => Promise<DeleteEmptyFolderOutcome>,
): Promise<ToolTextResult> {
  try {
    const outcome = await run();
    if (outcome.kind === "ok") {
      return textResult(outcome.result);
    }
    // Preserve counts and currentPath so callers can act on a refusal safely.
    return {
      ...textResult({
        ...outcome,
        ...(outcome.status === 503
          ? { guidance: DELETE_FOLDER_OVERLOAD_MESSAGE }
          : {}),
      }),
      isError: true,
    };
  } catch {
    return textError(DELETE_FOLDER_OVERLOAD_MESSAGE);
  }
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

/**
 * Send mermaid/PlantUML blocks to the diagram-check worker so agents get
 * syntax errors (with note line numbers) at write time instead of a generic
 * render failure in the browser later. A broken checker must never fail the
 * write itself.
 */
async function diagramCheckReport(markdown: string) {
  const blocks = extractDiagramBlocks(markdown);
  if (blocks.length === 0) {
    return null;
  }
  try {
    const response = await env.DIAGRAM_CHECK.fetch(
      "https://diagram-check.internal/",
      {
        body: JSON.stringify({ blocks }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    if (!response.ok) {
      return { checked: blocks.length, unavailable: true };
    }
    return (await response.json()) as DiagramCheckResult;
  } catch {
    return { checked: blocks.length, unavailable: true };
  }
}

/** Spread-ready `{ diagramCheck }` (or `{}`) for tool result objects. */
async function diagramCheckFields(markdown: string) {
  const check = await diagramCheckReport(markdown);
  return check ? { diagramCheck: check } : {};
}

async function editToolResult(noteId: string, result: ApplyEditResult) {
  if (!result.ok) {
    const suffix =
      result.matches === undefined ? "" : ` (matches: ${result.matches})`;
    return textError(`${result.message}${suffix}`);
  }
  return textResult({
    applied: true,
    cursor: result.cursor,
    ...(await diagramCheckFields(result.markdown)),
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
    return deniedToolError(result);
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
  if (loaded.note.editLocked) {
    return {
      error: textError(
        `${EDIT_LOCKED_CODE}: this note is edit-locked. Call set_edit_lock with locked=false first.`,
      ),
      ok: false,
    };
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
    ...(await diagramCheckFields(revision.markdown)),
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

/**
 * createMcpHandler に渡す MCP サーバーファクトリ。
 * Async so it can read the caller's feature configuration inside the auth
 * context (createMcpHandler awaits the factory per request).
 */
export async function createMcpServerFactory(context?: McpRequestContext) {
  if (await isBootstrapRequest(context)) {
    // Fresh per-request instance with the same advertised capabilities.
    // No tool is invoked by these methods; auth remains in handleMcp and
    // protocol/input validation remains entirely in the SDK.
    return new McpServer(
      { name: "miyulabmd", version: "0.1.0" },
      { capabilities: { tools: { listChanged: true } } },
    );
  }
  const server = new McpServer({
    name: "miyulabmd",
    version: "0.1.0",
  });
  const notes = createNoteService(env);
  const features = await featureConfig(env, requireUser());

  server.registerTool(
    "list_notes",
    toolDefinitions.list_notes,
    withToolTiming(
      "list_notes",
      async ({ folder_id, query, recursive, scheme_id }) => {
        const user = requireUser();
        if (!user) {
          return textError("Unauthorized");
        }
        const target = await folderIdArg(user, folder_id, scheme_id);
        if ("error" in target) {
          return textError(target.error);
        }
        const result = await listNotesForTool(notes, user, {
          folderId: target.folderId,
          query,
          recursive: recursive ?? false,
        });
        if ("error" in result) {
          return textError(result.error);
        }
        return textResult({ notes: result.notes });
      },
    ),
  );

  server.registerTool(
    "list_folder_entries",
    toolDefinitions.list_folder_entries,
    withToolTiming(
      "list_folder_entries",
      async ({ cursor, folder_id, limit }) => {
        const user = requireUser();
        if (!user) {
          return textError("Unauthorized");
        }

        let ownerId = user.id;
        let folderPath = "";
        let currentId: string | null;
        if (folder_id) {
          const rec = await getFolderById(env, folder_id);
          if (!rec) {
            return textError("Not found");
          }
          ownerId = rec.owner_id;
          folderPath = rec.folder;
          currentId = rec.id;
        } else {
          const root = await getFolderByPath(env, user.id, "");
          currentId = root?.id ?? (await ensureFolderRow(env, user.id, ""));
        }

        const snapshot =
          user.id === ownerId
            ? undefined
            : await buildAccessSnapshot(env, [ownerId]);
        const flags = await folderViewFlags(
          env,
          ownerId,
          folderPath,
          user,
          snapshot,
        );
        if (!flags.canView) {
          return textError("Not found");
        }
        return textResult(
          await listFolderChildren(
            env,
            ownerId,
            folderPath,
            currentId,
            user,
            { cursor, includeNoteCounts: false, limit },
            snapshot,
          ),
        );
      },
    ),
  );

  server.registerTool(
    "get_note",
    toolDefinitions.get_note,
    withToolTiming("get_note", async ({ id, numbered }) => {
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
    }),
  );

  server.registerTool(
    "create_note",
    toolDefinitions.create_note,
    withToolTiming(
      "create_note",
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

        return textResult({
          note: created,
          ...(await diagramCheckFields(created.markdown)),
        });
      },
    ),
  );

  server.registerTool(
    "replace_in_note",
    toolDefinitions.replace_in_note,
    withToolTiming(
      "replace_in_note",
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
          return textError(
            loaded.status === 401 ? "Unauthorized" : "Forbidden",
          );
        }
        if (!loaded.note.access.flags.canEdit) {
          return textError("Forbidden");
        }
        if (loaded.note.editLocked) {
          return textError(
            `${EDIT_LOCKED_CODE}: this note is edit-locked. Call set_edit_lock with locked=false first.`,
          );
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
    ),
  );

  server.registerTool(
    "insert_in_note",
    toolDefinitions.insert_in_note,
    withToolTiming("insert_in_note", async ({ id, text, at, after, before }) =>
      insertInNoteTool(notes, { after, at, before, id, text }),
    ),
  );

  server.registerTool(
    "update_note",
    toolDefinitions.update_note,
    withToolTiming("update_note", async ({ id, markdown }) => {
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
      if (note.editLocked) {
        return textError(
          `${EDIT_LOCKED_CODE}: this note is edit-locked. Call set_edit_lock with locked=false first.`,
        );
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
        ...(await diagramCheckFields(applied.markdown)),
        excerpt: applied.excerpt,
        id: note.id,
        markdownLength: applied.markdownLength,
        shortId: note.shortId,
        title: note.title,
      });
    }),
  );

  server.registerTool(
    "delete_note",
    toolDefinitions.delete_note,
    withToolTiming("delete_note", async ({ id }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }

      const result = await notes.remove(id, user);
      if (result.kind === "not_found") {
        return textError("Not found");
      }
      if (result.kind === "denied") {
        return deniedToolError(result);
      }
      if (result.kind !== "ok") {
        return textError("Failed to delete note");
      }

      return textResult({ deleted: true, id: result.note.id });
    }),
  );

  server.registerTool(
    "set_note_access",
    toolDefinitions.set_note_access,
    withToolTiming(
      "set_note_access",
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
        return mutateNoteToolResponse(result);
      },
    ),
  );

  server.registerTool(
    "invite_collaborator",
    toolDefinitions.invite_collaborator,
    withToolTiming("invite_collaborator", async ({ id, email, canWrite }) =>
      inviteCollaboratorTool(notes, { canWrite, email, id }),
    ),
  );

  server.registerTool(
    "search_notes",
    toolDefinitions.search_notes,
    withToolTiming(
      "search_notes",
      async ({ query, scope, folder_id, layer, limit, cursor, scheme_id }) => {
        const user = requireUser();
        if (!user) {
          return textError("Unauthorized");
        }

        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
          return textError("query is required");
        }
        const target = await folderIdArg(user, folder_id, scheme_id);
        if ("error" in target) {
          return textError(target.error);
        }

        const result = await notes.searchNotes(user, {
          cursor,
          folderIds: target.folderId ? [target.folderId] : undefined,
          layer,
          limit,
          query: trimmedQuery,
          scope,
        });
        if (result.kind === "not_found") {
          return textError("Not found");
        }
        return textResult({
          next_cursor: result.nextCursor,
          notes: result.notes,
          query: trimmedQuery,
        });
      },
    ),
  );

  server.registerTool(
    "grep_notes",
    toolDefinitions.grep_notes,
    withToolTiming(
      "grep_notes",
      async ({
        pattern,
        case_sensitive,
        context_after,
        context_before,
        fixed_string,
        folder_id,
        glob_title,
        max_matches_per_note,
        max_notes,
        scheme_id,
      }) => {
        const user = requireUser();
        if (!user) {
          return textError("Unauthorized");
        }
        const target = await folderIdArg(user, folder_id, scheme_id);
        if ("error" in target) {
          return textError(target.error);
        }

        const result = await notes.grep(user, {
          caseSensitive: case_sensitive,
          contextAfter: context_after,
          contextBefore: context_before,
          fixedString: fixed_string,
          folderIds: target.folderId ? [target.folderId] : undefined,
          globTitle: glob_title,
          maxMatchesPerNote: max_matches_per_note,
          maxNotes: max_notes,
          pattern,
        });
        if (result.kind === "not_found") {
          return textError("Not found");
        }
        if (result.kind === "bad_request") {
          return textError(result.error);
        }
        return textResult({
          matches: result.matches.map((match) => ({
            after: match.after,
            before: match.before,
            column: match.column,
            line: match.line,
            note_id: match.noteId,
            snapshot_updated_at: match.snapshotUpdatedAt,
            text: match.text,
            title: match.title,
          })),
          scanned_notes: result.scannedNotes,
          truncated: result.truncated,
        });
      },
    ),
  );

  server.registerTool(
    "list_note_links",
    toolDefinitions.list_note_links,
    withToolTiming("list_note_links", async ({ id }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }
      const result = await listNoteLinks(env, id, user);
      if (result.kind === "not_found") {
        return textError("Not found");
      }
      if (result.kind === "denied") {
        return textError(result.status === 401 ? "Unauthorized" : "Forbidden");
      }
      return textResult(result.result);
    }),
  );

  server.registerTool(
    "list_backlinks",
    toolDefinitions.list_backlinks,
    withToolTiming("list_backlinks", async ({ id }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }
      const result = await listBacklinks(env, id, user);
      if (result.kind === "not_found") {
        return textError("Not found");
      }
      if (result.kind === "denied") {
        return textError(result.status === 401 ? "Unauthorized" : "Forbidden");
      }
      return textResult({ backlinks: result.backlinks });
    }),
  );

  server.registerTool(
    "list_broken_links",
    toolDefinitions.list_broken_links,
    withToolTiming("list_broken_links", async () => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }
      return textResult({ broken: await listBrokenLinks(env, user) });
    }),
  );

  server.registerTool(
    "resolve_wikilink",
    toolDefinitions.resolve_wikilink,
    withToolTiming("resolve_wikilink", async ({ target, context_id }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }
      const result = await resolveWikilink(env, user, target, context_id);
      if (result.kind === "not_found") {
        return textError("Not found");
      }
      if (result.kind === "denied") {
        return textError(result.status === 401 ? "Unauthorized" : "Forbidden");
      }
      return textResult(result.resolution);
    }),
  );

  server.registerTool(
    "agent_join",
    toolDefinitions.agent_join,
    withToolTiming("agent_join", async ({ id }) => {
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
    }),
  );

  server.registerTool(
    "agent_leave",
    toolDefinitions.agent_leave,
    withToolTiming("agent_leave", async ({ id }) => {
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
    }),
  );

  server.registerTool(
    "list_note_history",
    toolDefinitions.list_note_history,
    withToolTiming("list_note_history", async ({ id, limit, before }) =>
      listNoteHistoryTool(notes, { before, id, limit }),
    ),
  );

  server.registerTool(
    "get_revision",
    toolDefinitions.get_revision,
    withToolTiming("get_revision", async ({ id, revisionId }) =>
      getRevisionTool(notes, { id, revisionId }),
    ),
  );

  server.registerTool(
    "restore_revision",
    toolDefinitions.restore_revision,
    withToolTiming("restore_revision", async ({ id, revisionId }) =>
      restoreRevisionTool(notes, { id, revisionId }),
    ),
  );

  server.registerTool(
    "delete_folder",
    toolDefinitions.delete_folder,
    withToolTiming(
      "delete_folder",
      async ({ folder_id, path, expected_path, dry_run }) => {
        const user = requireUser();
        if (!user) {
          return textError("Unauthorized");
        }
        return await runDeleteFolderTool(() =>
          deleteEmptyFolder(
            env,
            { dry_run, expected_path, folder_id, path },
            user,
            actorFromAgent(agentOf(user)),
          ),
        );
      },
    ),
  );

  server.registerTool(
    "move_folder",
    toolDefinitions.move_folder,
    withToolTiming(
      "move_folder",
      async ({ folder_id, dest_folder_id, name, dry_run }) => {
        const user = requireUser();
        if (!user) {
          return textError("Unauthorized");
        }
        return await runMoveTool(() =>
          moveFolder(
            env,
            folder_id,
            { destFolderId: dest_folder_id, dryRun: dry_run, name },
            user,
          ),
        );
      },
    ),
  );

  server.registerTool(
    "move_folder_contents",
    toolDefinitions.move_folder_contents,
    withToolTiming(
      "move_folder_contents",
      async ({ folder_id, dest_folder_id, include_subfolders, dry_run }) => {
        const user = requireUser();
        if (!user) {
          return textError("Unauthorized");
        }
        return await runMoveTool(() =>
          moveFolderContents(
            env,
            folder_id,
            {
              destFolderId: dest_folder_id,
              dryRun: dry_run,
              includeSubfolders: include_subfolders,
            },
            user,
          ),
        );
      },
    ),
  );

  server.registerTool(
    "move_notes",
    toolDefinitions.move_notes,
    withToolTiming("move_notes", async ({ note_ids, folder_id, dry_run }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }
      return await runMoveTool(() =>
        moveNotes(
          env,
          { destFolderId: folder_id, dryRun: dry_run, noteIds: note_ids },
          user,
        ),
      );
    }),
  );

  // para_* tools exist only once a PARA space is configured.
  if (features.hasPara) {
    server.registerTool(
      "para_list",
      toolDefinitions.para_list,
      withToolTiming("para_list", async ({ bucket, space }) => {
        const user = requireUser();
        if (!user) {
          return textError("Unauthorized");
        }
        const result = await paraList(env, user, bucket, space);
        if (result.kind === "denied") {
          return textError("Unauthorized");
        }
        if (result.kind === "invalid") {
          return textError(result.error);
        }
        return textResult(result.result);
      }),
    );

    server.registerTool(
      "para_archive_project",
      toolDefinitions.para_archive_project,
      withToolTiming(
        "para_archive_project",
        async ({ folder_id, dated, name, dry_run }) => {
          const user = requireUser();
          if (!user) {
            return textError("Unauthorized");
          }
          return await runMoveTool(() =>
            paraArchiveProject(
              env,
              folder_id,
              { dated, dryRun: dry_run, name },
              user,
            ),
          );
        },
      ),
    );
  }

  // scheme_*/jd_* tools exist only once a naming-scheme folder is configured.
  if (features.hasSchemes) {
    server.registerTool(
      "set_folder_scheme",
      toolDefinitions.set_folder_scheme,
      withToolTiming("set_folder_scheme", async ({ folder_id, scheme }) => {
        const user = requireUser();
        if (!user) {
          return textError("Unauthorized");
        }
        const result = await setFolderScheme(env, folder_id, scheme, user);
        if (result.kind !== "ok") {
          return moveToolError(result);
        }
        return textResult(result.result);
      }),
    );

    server.registerTool(
      "scheme_get",
      toolDefinitions.scheme_get,
      withToolTiming("scheme_get", async ({ id }) => {
        const user = requireUser();
        if (!user) {
          return textError("Unauthorized");
        }
        const result = await schemeGet(env, id, user);
        if (result.kind !== "ok") {
          return moveToolError(result);
        }
        return textResult(result.result);
      }),
    );

    server.registerTool(
      "jd_allocate_id",
      toolDefinitions.jd_allocate_id,
      withToolTiming("jd_allocate_id", async ({ folder_id }) => {
        const user = requireUser();
        if (!user) {
          return textError("Unauthorized");
        }
        const result = await jdAllocateId(env, folder_id, user);
        if (result.kind !== "ok") {
          return moveToolError(result);
        }
        return textResult(result.result);
      }),
    );

    server.registerTool(
      "jd_create_id_folder",
      toolDefinitions.jd_create_id_folder,
      withToolTiming(
        "jd_create_id_folder",
        async ({ folder_id, scheme_id, title }) => {
          const user = requireUser();
          if (!user) {
            return textError("Unauthorized");
          }
          const result = await createSchemeChild(
            env,
            folder_id,
            { schemeId: scheme_id, title },
            user,
          );
          if (result.kind !== "ok") {
            return moveToolError(result);
          }
          return textResult(result.result);
        },
      ),
    );

    server.registerTool(
      "jd_get",
      toolDefinitions.jd_get,
      withToolTiming("jd_get", async ({ id }) => {
        const user = requireUser();
        if (!user) {
          return textError("Unauthorized");
        }
        const result = await schemeGet(env, id, user);
        if (result.kind !== "ok") {
          return moveToolError(result);
        }
        return textResult(result.result);
      }),
    );

    server.registerTool(
      "jd_list_category",
      toolDefinitions.jd_list_category,
      withToolTiming("jd_list_category", async ({ folder_id }) => {
        const user = requireUser();
        if (!user) {
          return textError("Unauthorized");
        }
        const result = await jdListCategory(env, folder_id, user);
        if (result.kind !== "ok") {
          return moveToolError(result);
        }
        return textResult(result.result);
      }),
    );

    server.registerTool(
      "jd_validate_tree",
      toolDefinitions.jd_validate_tree,
      withToolTiming("jd_validate_tree", async () => {
        const user = requireUser();
        if (!user) {
          return textError("Unauthorized");
        }
        const result = await validateSchemeTree(env, user);
        if (result.kind !== "ok") {
          return moveToolError(result);
        }
        return textResult(result.result);
      }),
    );
  }

  // §2.6 permanent edit lock — always available (not feature-gated).
  server.registerTool(
    "set_edit_lock",
    toolDefinitions.set_edit_lock,
    withToolTiming("set_edit_lock", async ({ id, locked, confirm }) => {
      const user = requireUser();
      if (!user) {
        return textError("Unauthorized");
      }
      // §2.6: unlocking via MCP requires an explicit confirm so a tool call
      // cannot silently reopen a preserved note.
      if (!locked && confirm !== true) {
        return textError(
          "confirm=true is required to unlock a note (set_edit_lock with locked=false)",
        );
      }
      const result = await notes.setEditLock(id, user, locked);
      return mutateNoteToolResponse(result);
    }),
  );

  // medallion_* tools exist only once a medallion set is configured.
  if (features.hasMedallion) {
    server.registerTool(
      "medallion_list_sets",
      toolDefinitions.medallion_list_sets,
      withToolTiming("medallion_list_sets", async () => {
        const user = requireUser();
        if (!user) {
          return textError("Unauthorized");
        }
        return textResult({
          assignments: await listMedallionAssignments(env, user),
          sets: await listMedallionSets(env, user),
        });
      }),
    );

    server.registerTool(
      "medallion_assign_folder",
      toolDefinitions.medallion_assign_folder,
      withToolTiming(
        "medallion_assign_folder",
        async ({ folder_id, set_id, layer }) => {
          const user = requireUser();
          if (!user) {
            return textError("Unauthorized");
          }
          const result = await assignFolderMedallion(
            env,
            user,
            folder_id,
            set_id,
            layer,
          );
          if (result.kind !== "ok") {
            return medallionToolError(result);
          }
          return textResult({ assignment: result.result });
        },
      ),
    );

    server.registerTool(
      "medallion_unassign_folder",
      toolDefinitions.medallion_unassign_folder,
      withToolTiming("medallion_unassign_folder", async ({ folder_id }) => {
        const user = requireUser();
        if (!user) {
          return textError("Unauthorized");
        }
        const result = await clearFolderMedallion(env, user, folder_id);
        if (result.kind !== "ok") {
          return medallionToolError(result);
        }
        return textResult({ cleared: true, folder_id });
      }),
    );
  }

  return server;
}

import type { SessionUser } from "@miyulabmd/shared";
import { queryCatalogNotes } from "../durable-objects/catalog-list.ts";
import {
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
import { createNoteService } from "../services/notes.ts";
import { folderIdsForSchemeId } from "../services/schemes.ts";

type ReadToolResult = {
  content: [{ text: string; type: "text" }];
  isError?: true;
};

function textResult(data: unknown): ReadToolResult {
  return {
    content: [{ text: JSON.stringify(data, null, 2), type: "text" }],
  };
}

function textError(message: string): ReadToolResult {
  return {
    content: [{ text: message, type: "text" }],
    isError: true,
  };
}

function stringField(args: Readonly<Record<string, unknown>>, key: string) {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function booleanField(args: Readonly<Record<string, unknown>>, key: string) {
  const value = args[key];
  return typeof value === "boolean" ? value : undefined;
}

function numberField(args: Readonly<Record<string, unknown>>, key: string) {
  const value = args[key];
  return typeof value === "number" ? value : undefined;
}

async function folderIdArg(
  env: Env,
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

async function listNotes(
  env: Env,
  user: SessionUser,
  args: Readonly<Record<string, unknown>>,
): Promise<ReadToolResult> {
  const target = await folderIdArg(
    env,
    user,
    stringField(args, "folder_id"),
    stringField(args, "scheme_id"),
  );
  if ("error" in target) {
    return textError(target.error);
  }
  const result = await queryCatalogNotes(env, user, {
    folderId: target.folderId,
    query: stringField(args, "query"),
    recursive: booleanField(args, "recursive") ?? false,
  });
  if ("error" in result) {
    return textError(result.error);
  }
  return textResult({ notes: result.notes });
}

async function listFolderEntries(
  env: Env,
  user: SessionUser,
  args: Readonly<Record<string, unknown>>,
): Promise<ReadToolResult> {
  const folderId = stringField(args, "folder_id");
  let ownerId = user.id;
  let folderPath = "";
  let currentId: string | null;
  if (folderId) {
    const rec = await getFolderById(env, folderId);
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
    user.id === ownerId ? undefined : await buildAccessSnapshot(env, [ownerId]);
  const flags = await folderViewFlags(env, ownerId, folderPath, user, snapshot);
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
      {
        cursor: stringField(args, "cursor"),
        includeNoteCounts: false,
        limit: numberField(args, "limit"),
      },
      snapshot,
    ),
  );
}

async function searchNotes(
  env: Env,
  user: SessionUser,
  args: Readonly<Record<string, unknown>>,
): Promise<ReadToolResult> {
  const trimmedQuery = stringField(args, "query")?.trim() ?? "";
  if (!trimmedQuery) {
    return textError("query is required");
  }
  const target = await folderIdArg(
    env,
    user,
    stringField(args, "folder_id"),
    stringField(args, "scheme_id"),
  );
  if ("error" in target) {
    return textError(target.error);
  }
  const scope = stringField(args, "scope");
  const notes = createNoteService(env);
  const result = await notes.searchNotes(user, {
    cursor: stringField(args, "cursor"),
    folderIds: target.folderId ? [target.folderId] : undefined,
    layer: stringField(args, "layer"),
    limit: numberField(args, "limit"),
    query: trimmedQuery,
    scope:
      scope === "title" || scope === "body" || scope === "all"
        ? scope
        : undefined,
  });
  if (result.kind === "not_found") {
    return textError("Not found");
  }
  return textResult({
    next_cursor: result.nextCursor,
    notes: result.notes,
    query: trimmedQuery,
  });
}

async function grepNotes(
  env: Env,
  user: SessionUser,
  args: Readonly<Record<string, unknown>>,
): Promise<ReadToolResult> {
  const target = await folderIdArg(
    env,
    user,
    stringField(args, "folder_id"),
    stringField(args, "scheme_id"),
  );
  if ("error" in target) {
    return textError(target.error);
  }
  const notes = createNoteService(env);
  const result = await notes.grep(user, {
    caseSensitive: booleanField(args, "case_sensitive"),
    contextAfter: numberField(args, "context_after"),
    contextBefore: numberField(args, "context_before"),
    fixedString: booleanField(args, "fixed_string"),
    folderIds: target.folderId ? [target.folderId] : undefined,
    globTitle: stringField(args, "glob_title"),
    maxMatchesPerNote: numberField(args, "max_matches_per_note"),
    maxNotes: numberField(args, "max_notes"),
    pattern: stringField(args, "pattern") ?? "",
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
}

async function getNote(
  env: Env,
  user: SessionUser,
  args: Readonly<Record<string, unknown>>,
): Promise<ReadToolResult> {
  const id = stringField(args, "id");
  if (!id) {
    return textError("Not found");
  }
  const notes = createNoteService(env);
  const result = await notes.get(id, user);
  if (result.kind === "not_found") {
    return textError("Not found");
  }
  if (result.kind === "denied") {
    return textError(result.status === 401 ? "Unauthorized" : "Forbidden");
  }
  if (result.kind !== "ok") {
    return textError("Not found");
  }
  const note = result.note;
  const markdown = await env.DOCUMENT_ROOM.get(
    env.DOCUMENT_ROOM.idFromName(note.id),
  ).readForAgent(note.id, {
    displayName: user.displayName?.trim() || user.email,
    userId: user.id,
  });
  const numbered = booleanField(args, "numbered");
  return textResult({
    note: { ...note, markdown },
    outline: markdownOutline(markdown),
    ...(numbered ? { numberedMarkdown: numberMarkdownLines(markdown) } : {}),
  });
}

export async function runReadTool(
  env: Env,
  user: SessionUser,
  name: string,
  args: object,
): Promise<ReadToolResult> {
  const record = args as Readonly<Record<string, unknown>>;
  switch (name) {
    case "list_notes":
      return await listNotes(env, user, record);
    case "list_folder_entries":
      return await listFolderEntries(env, user, record);
    case "search_notes":
      return await searchNotes(env, user, record);
    case "grep_notes":
      return await grepNotes(env, user, record);
    case "get_note":
      return await getNote(env, user, record);
    default:
      return textError("Not found");
  }
}

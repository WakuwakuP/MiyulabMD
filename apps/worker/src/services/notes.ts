import {
  type AccessScope,
  articleMetaFromNote,
  type CreateNoteInput,
  clampWriteScope,
  defaultNoteMarkdown,
  ensureArticleMarkdown,
  type FolderAccess,
  folderContains,
  isAccessScope,
  isPermissionPreset,
  matchArticleSource,
  type Note,
  type NoteSummary,
  normalizeFolder,
  type PermissionPreset,
  presetFromScopes,
  rewriteFolderPrefix,
  type SessionUser,
  scopesFromPreset,
  titleFromMarkdown,
  type UpdateNoteMetaInput,
} from "@miyulabmd/shared";

import { db } from "../db/client.ts";
import { upsertUserByEmail } from "../db/users.ts";
import { instanceFlags } from "../env.ts";
import {
  canDiscoverAccess,
  defaultScopes,
  deleteFolderTree,
  derivedPermission,
  ensureFolderRow,
  folderDiscoveryAllowed,
  getFolderById,
  getFolderByPath,
  listPublicFolderCandidates,
  listSharedFolderCandidates,
  type NoteAccessFields,
  noteMatchesFolderGrant,
  parentFolderPath,
  renameFolderTree,
  replaceGrants,
  resolveFolderAccess,
  resolveNoteAccess,
} from "./access.ts";
import {
  createArticleService,
  deleteArticleSourcesInFolder,
  escapeLikePattern,
  rewriteArticleSourceFolders,
} from "./articles.ts";
import { deleteRevisionsForNote } from "./history.ts";
import { createImageService } from "./images.ts";
import { viewDeniedHttpStatus } from "./permissions.ts";

type NoteRow = {
  id: string;
  short_id: string;
  alias: string | null;
  owner_id: string;
  title: string;
  folder: string;
  permission: string;
  read_scope: string | null;
  write_scope: string | null;
  markdown_snapshot: string;
  created_at: number;
  updated_at: number;
  article_meta: string | null;
};

const SHORT_ID_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ANONYMOUS_OWNER_EMAIL = "anonymous@miyulabmd.local";
const NOTE_COLUMNS = `id, short_id, alias, owner_id, title, folder, permission, read_scope, write_scope,
                  markdown_snapshot, created_at, updated_at, article_meta`;
const NOTE_COLUMNS_N = `n.id, n.short_id, n.alias, n.owner_id, n.title, n.folder, n.permission, n.read_scope, n.write_scope,
                  n.markdown_snapshot, n.created_at, n.updated_at, n.article_meta`;

function parseStoredScope(value: string | null): AccessScope | null {
  return value && isAccessScope(value) ? value : null;
}

function accessFields(row: NoteRow): NoteAccessFields {
  return {
    folder: row.folder ?? "",
    id: row.id,
    ownerId: row.owner_id,
    readScope: parseStoredScope(row.read_scope),
    writeScope: parseStoredScope(row.write_scope),
  };
}

async function toNote(
  env: Env,
  row: NoteRow,
  user?: SessionUser | null,
): Promise<Note> {
  const access = await resolveNoteAccess(env, accessFields(row), user);
  const isOwner = user?.id === row.owner_id;
  const folder = row.folder ?? "";
  const folderId = await ensureFolderRow(env, row.owner_id, folder);
  let visibleFolderId = isOwner ? folderId : null;
  if (
    !isOwner &&
    folderId &&
    (await folderDiscoveryAllowed(env, row.owner_id, folder, user))
  ) {
    visibleFolderId = folderId;
  }
  return {
    access: isOwner ? access : { ...access, grants: [], sourceFolder: null },
    alias: row.alias,
    articleMeta: articleMetaFromNote(row.markdown_snapshot, row.article_meta),
    createdAt: row.created_at,
    folder: isOwner ? folder : "",
    folderId: visibleFolderId,
    id: row.id,
    markdown: row.markdown_snapshot,
    ownerId: row.owner_id,
    permission: derivedPermission(access),
    shortId: row.short_id,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

async function toSummary(
  env: Env,
  row: NoteRow,
  user?: SessionUser | null,
): Promise<NoteSummary> {
  const note = await toNote(env, row, user);
  const { markdown: _markdown, ...summary } = note;
  return summary;
}

function generateShortId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(
    bytes,
    (byte) => SHORT_ID_CHARS[byte % SHORT_ID_CHARS.length],
  ).join("");
}

async function generateUniqueShortId(env: Env): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const shortId = generateShortId();
    const existing = await db(env)
      .prepare("SELECT id FROM notes WHERE short_id = ?")
      .bind(shortId)
      .first<{ id: string }>();
    if (!existing) {
      return shortId;
    }
  }
  throw new Error("failed to generate unique short_id");
}

/** DocumentRoom から D1 へ markdown_snapshot をデバウンス書き込みする。 */
export async function persistMarkdownSnapshot(
  env: Env,
  noteId: string,
  markdown: string,
): Promise<void> {
  const now = Date.now();
  const title = titleFromMarkdown(markdown);
  await db(env)
    .prepare(
      "UPDATE notes SET markdown_snapshot = ?, title = ?, snapshot_updated_at = ?, updated_at = ? WHERE id = ?",
    )
    .bind(markdown, title, now, now, noteId)
    .run();
}

function findNoteRow(env: Env, idOrShortId: string): Promise<NoteRow | null> {
  return db(env)
    .prepare(
      `SELECT ${NOTE_COLUMNS}
       FROM notes
       WHERE id = ? OR short_id = ?`,
    )
    .bind(idOrShortId, idOrShortId)
    .first<NoteRow>();
}

function rejectPublicWrite(
  env: Env,
  writeScope: AccessScope | null,
): string | null {
  if (
    (writeScope === "public" || writeScope === "link") &&
    !instanceFlags(env).allowAnonymousEdits
  ) {
    return "匿名ユーザーによる書き込みは、匿名編集が無効なため使えません";
  }
  return null;
}

type ScopesInput = {
  inheritAccess?: boolean;
  permission?: PermissionPreset;
  readScope?: AccessScope | null;
  writeScope?: AccessScope | null;
};

type CurrentScopes = {
  readScope: AccessScope | null;
  writeScope: AccessScope | null;
};

type ScopesResult =
  | {
      inherit: true;
      readScope: null;
      writeScope: null;
      permission: PermissionPreset;
    }
  | {
      inherit: false;
      readScope: AccessScope;
      writeScope: AccessScope;
      permission: PermissionPreset;
    }
  | { error: string };

function inheritedScopes(env: Env): Extract<ScopesResult, { inherit: true }> {
  const fallback = defaultScopes(env);
  return {
    inherit: true,
    permission: presetFromScopes(fallback.readScope, fallback.writeScope),
    readScope: null,
    writeScope: null,
  };
}

function scopesFromPresetInput(
  env: Env,
  permission: PermissionPreset,
): ScopesResult {
  const scopes = scopesFromPreset(permission);
  const denied = rejectPublicWrite(env, scopes.writeScope);
  if (denied) {
    return { error: denied };
  }
  return { inherit: false, ...scopes, permission };
}

function scopesFromCurrent(
  env: Env,
  current: CurrentScopes,
): ScopesResult | null {
  if (current.readScope === null && current.writeScope === null) {
    return inheritedScopes(env);
  }
  if (current.readScope && current.writeScope) {
    return {
      inherit: false,
      permission: presetFromScopes(current.readScope, current.writeScope),
      readScope: current.readScope,
      writeScope: current.writeScope,
    };
  }
  return null;
}

function scopesFromExplicit(
  env: Env,
  input: ScopesInput,
  current?: CurrentScopes,
): ScopesResult {
  const fallback = defaultScopes(env);
  const readScope =
    (input.readScope === null ? null : input.readScope) ??
    current?.readScope ??
    fallback.readScope;
  if (!readScope) {
    return inheritedScopes(env);
  }
  const writeScope = clampWriteScope(
    readScope,
    input.writeScope ?? current?.writeScope ?? fallback.writeScope,
  );
  const denied = rejectPublicWrite(env, writeScope);
  if (denied) {
    return { error: denied };
  }
  return {
    inherit: false,
    permission: presetFromScopes(readScope, writeScope),
    readScope,
    writeScope,
  };
}

function scopesFromInput(
  env: Env,
  input: ScopesInput,
  current?: CurrentScopes,
): ScopesResult {
  if (input.inheritAccess === true) {
    return inheritedScopes(env);
  }

  if (input.permission && isPermissionPreset(input.permission)) {
    return scopesFromPresetInput(env, input.permission);
  }

  const wantsExplicit =
    input.inheritAccess === false ||
    input.readScope !== undefined ||
    input.writeScope !== undefined;

  if (!(wantsExplicit || current)) {
    return inheritedScopes(env);
  }

  if (!wantsExplicit && current) {
    const fromCurrent = scopesFromCurrent(env, current);
    if (fromCurrent) {
      return fromCurrent;
    }
  }

  return scopesFromExplicit(env, input, current);
}

async function resolveOwnerForCreate(
  env: Env,
  user: SessionUser | undefined,
): Promise<SessionUser | { error: string }> {
  if (user) {
    return user;
  }

  const { allowAnonymous } = instanceFlags(env);
  if (!allowAnonymous) {
    return { error: "login required" };
  }

  const anonymousOwner = await upsertUserByEmail(
    env,
    ANONYMOUS_OWNER_EMAIL,
    "Anonymous",
  );
  return {
    displayName: anonymousOwner.displayName,
    email: anonymousOwner.email,
    id: anonymousOwner.id,
  };
}

function mergeNoteRows(rows: NoteRow[]): NoteRow[] {
  const map = new Map<string, NoteRow>();
  for (const row of rows) {
    map.set(row.id, row);
  }
  return [...map.values()].sort((a, b) => b.updated_at - a.updated_at);
}

function buildFolderPrefixCondition(folders: string[]): {
  clause: string;
  binds: string[];
} {
  const unique = [...new Set(folders.filter(Boolean))];
  if (unique.length === 0) {
    return { binds: [], clause: "1=0" };
  }

  const parts: string[] = [];
  const binds: string[] = [];
  for (const folder of unique) {
    parts.push("folder = ?", "folder LIKE ? ESCAPE '\\'");
    binds.push(folder, `${escapeLikePattern(folder)}/%`);
  }

  return { binds, clause: `(${parts.join(" OR ")})` };
}

async function listGuestInheritedRowsFromPublicFolders(
  env: Env,
): Promise<NoteRow[]> {
  const publicFolders = await listPublicFolderCandidates(env);
  if (publicFolders.length === 0) {
    return [];
  }

  const foldersByOwner = new Map<string, string[]>();
  for (const row of publicFolders) {
    const list = foldersByOwner.get(row.ownerId) ?? [];
    list.push(row.folder);
    foldersByOwner.set(row.ownerId, list);
  }

  const candidates: NoteRow[] = [];
  for (const [ownerId, folders] of foldersByOwner) {
    const { clause, binds } = buildFolderPrefixCondition(folders);
    if (binds.length === 0) {
      continue;
    }

    const rows = await db(env)
      .prepare(
        `SELECT ${NOTE_COLUMNS}
           FROM notes
          WHERE owner_id = ?
            AND read_scope IS NULL
            AND write_scope IS NULL
            AND ${clause}
          ORDER BY updated_at DESC`,
      )
      .bind(ownerId, ...binds)
      .all<NoteRow>();
    candidates.push(...(rows.results ?? []));
  }

  return candidates;
}

async function listAccessibleRows(
  env: Env,
  user: SessionUser,
): Promise<NoteRow[]> {
  const owned = await db(env)
    .prepare(
      `SELECT DISTINCT ${NOTE_COLUMNS_N}
           FROM notes n
           LEFT JOIN access_grants ag
             ON ag.target_kind = 'note' AND ag.target_key = n.id
            AND (ag.user_id = ? OR ag.email = ?)
           WHERE n.owner_id = ? OR ag.id IS NOT NULL OR n.read_scope = 'public'
           ORDER BY n.updated_at DESC`,
    )
    .bind(user.id, user.email, user.id)
    .all<NoteRow>();

  const folderGrants = await listSharedFolderCandidates(env, user);
  const extra: NoteRow[] = [];
  for (const grant of folderGrants) {
    const rows = await db(env)
      .prepare(
        `SELECT ${NOTE_COLUMNS} FROM notes WHERE owner_id = ? ORDER BY updated_at DESC`,
      )
      .bind(grant.ownerId)
      .all<NoteRow>();
    for (const row of rows.results ?? []) {
      if (noteMatchesFolderGrant(row.folder ?? "", grant.folder)) {
        extra.push(row);
      }
    }
  }

  const candidates = mergeNoteRows([...(owned.results ?? []), ...extra]);
  // 親の共有設定より狭い範囲を指定したノートは一覧・検索に漏らさない。
  const visible = await Promise.all(
    candidates.map(async (row) => {
      const access = await resolveNoteAccess(env, accessFields(row), user);
      return canDiscoverAccess(access, row.owner_id, user) ? row : null;
    }),
  );
  return visible.filter((row): row is NoteRow => row !== null);
}

async function listGuestRows(env: Env): Promise<NoteRow[]> {
  const allowAnonymousViews = instanceFlags(env).allowAnonymousViews;
  if (!allowAnonymousViews) {
    return [];
  }

  const [publicDirect, inheritedFromFolder] = await Promise.all([
    db(env)
      .prepare(
        `SELECT ${NOTE_COLUMNS} FROM notes WHERE read_scope = 'public' ORDER BY updated_at DESC`,
      )
      .all<NoteRow>(),
    listGuestInheritedRowsFromPublicFolders(env),
  ]);

  const candidates = mergeNoteRows([
    ...(publicDirect.results ?? []),
    ...inheritedFromFolder,
  ]);

  const visible = await Promise.all(
    candidates.map(async (row) => {
      const access = await resolveNoteAccess(env, accessFields(row), undefined);
      return canDiscoverAccess(access, row.owner_id) ? row : null;
    }),
  );

  return visible.filter((row): row is NoteRow => row !== null);
}

export type NoteSearchHit = NoteSummary & {
  snippet?: string;
};

function excerptSnapshot(text: string, start: number, length: number): string {
  const radius = 80;
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, start + length + radius);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < text.length ? "…" : "";
  return `${prefix}${text.slice(from, to)}${suffix}`;
}

export type GetNoteResult =
  | { kind: "ok"; note: Note }
  | { kind: "not_found" }
  | { kind: "denied"; status: 401 | 403 };

export type MutateNoteResult =
  | { kind: "ok"; note: Note }
  | { kind: "not_found" }
  | { kind: "denied"; status: 401 | 403 }
  | { kind: "bad_request"; error: string };

export type RemoveFolderResult =
  | { kind: "ok" }
  | { kind: "not_found" }
  | { kind: "denied"; status: 401 | 403 };

export type RenameFolderResult =
  | { kind: "ok"; access: FolderAccess }
  | { kind: "not_found" }
  | { kind: "denied"; status: 401 | 403 }
  | { kind: "invalid"; error: string; status: number };

async function resolveCreateFolder(
  env: Env,
  ownerId: string,
  input: CreateNoteInput,
): Promise<{ folder: string } | { error: string; status: number }> {
  let folder = normalizeFolder(input.folder);
  if (input.folderId) {
    const rec = await getFolderById(env, input.folderId);
    if (!rec) {
      return { error: "フォルダが見つかりません", status: 400 };
    }
    folder = rec.owner_id === ownerId ? rec.folder : "";
  }
  return { folder };
}

async function markdownForCreate(
  env: Env,
  ownerId: string,
  folder: string,
  input: CreateNoteInput,
): Promise<string> {
  let markdown =
    input.markdown ?? defaultNoteMarkdown(input.title?.trim() || "無題");
  const sources = await createArticleService(env).listSources(ownerId);
  const source = matchArticleSource(folder, sources);
  if (source) {
    markdown = ensureArticleMarkdown(
      markdown,
      source.schema,
      input.title?.trim() || "無題",
    );
  }
  return markdown;
}

function mutateDenied(
  env: Env,
  ownerId: string,
  flags: Note["access"]["flags"],
  user: SessionUser | undefined,
): { kind: "denied"; status: 401 | 403 } {
  return {
    kind: "denied",
    status:
      user === undefined
        ? viewDeniedHttpStatus({ flags, ownerId }, undefined, env)
        : 403,
  };
}

function hasAdminMetaFields(input: UpdateNoteMetaInput): boolean {
  return (
    input.permission !== undefined ||
    input.alias !== undefined ||
    input.folder !== undefined ||
    input.inheritAccess !== undefined ||
    input.readScope !== undefined ||
    input.writeScope !== undefined ||
    input.grants !== undefined
  );
}

function nextMetaValues(row: NoteRow, input: UpdateNoteMetaInput) {
  return {
    alias: input.alias === undefined ? row.alias : input.alias,
    folder:
      input.folder === undefined
        ? (row.folder ?? "")
        : normalizeFolder(input.folder),
    title: input.title === undefined ? row.title : input.title.trim() || "無題",
  };
}

async function replaceNoteGrantsIfNeeded(
  env: Env,
  row: NoteRow,
  grants: UpdateNoteMetaInput["grants"],
): Promise<{ error: string } | null> {
  if (!grants) {
    return null;
  }
  const replaced = await replaceGrants(
    env,
    row.owner_id,
    "note",
    row.id,
    grants,
  );
  if ("error" in replaced) {
    return { error: replaced.error };
  }
  return null;
}

function folderOwnerDenied(
  ownerId: string,
  user: SessionUser | undefined,
): { kind: "denied"; status: 401 | 403 } | null {
  if (!user || user.id !== ownerId) {
    return { kind: "denied", status: user === undefined ? 401 : 403 };
  }
  return null;
}

async function deleteOwnedNotesInFolder(
  env: Env,
  ownerId: string,
  folder: string,
): Promise<void> {
  const owned = await db(env)
    .prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE owner_id = ?`)
    .bind(ownerId)
    .all<NoteRow>();
  const images = createImageService(env);
  for (const row of owned.results ?? []) {
    if (!folderContains(folder, row.folder ?? "")) {
      continue;
    }
    await images.deleteAllForNote(row.id);
    await deleteRevisionsForNote(env, row.id);
    await db(env)
      .prepare(
        "DELETE FROM access_grants WHERE target_kind = 'note' AND target_key = ?",
      )
      .bind(row.id)
      .run();
    await db(env).prepare("DELETE FROM notes WHERE id = ?").bind(row.id).run();
  }
}

async function rewriteOwnedNoteFolders(
  env: Env,
  ownerId: string,
  from: string,
  to: string,
): Promise<void> {
  const owned = await db(env)
    .prepare("SELECT id, folder FROM notes WHERE owner_id = ?")
    .bind(ownerId)
    .all<{ id: string; folder: string }>();
  for (const row of owned.results ?? []) {
    const next = rewriteFolderPrefix(row.folder ?? "", from, to);
    if (next === null) {
      continue;
    }
    await db(env)
      .prepare("UPDATE notes SET folder = ? WHERE id = ?")
      .bind(next, row.id)
      .run();
  }
}

type FolderRecord = NonNullable<Awaited<ReturnType<typeof getFolderById>>>;

async function validateRenameFolder(
  env: Env,
  rec: FolderRecord,
  name: string,
  user: SessionUser | undefined,
): Promise<{ nextPath: string } | RenameFolderResult> {
  const denied = folderOwnerDenied(rec.owner_id, user);
  if (denied) {
    return denied;
  }
  if (!rec.folder) {
    return {
      error: "マイドライブの名前は変更できません",
      kind: "invalid",
      status: 400,
    };
  }
  const parent = parentFolderPath(rec.folder);
  const nextPath = parent ? `${parent}/${name}` : name;
  if (nextPath === rec.folder) {
    return {
      access: await resolveFolderAccess(env, rec.owner_id, rec.folder, user),
      kind: "ok",
    };
  }
  const conflict = await getFolderByPath(env, rec.owner_id, nextPath);
  if (conflict) {
    return {
      error: "同じ名前のフォルダが既にあります",
      kind: "invalid",
      status: 409,
    };
  }
  return { nextPath };
}

/** HTTP と MCP が共有するノートドメイン。 */
export function createNoteService(env: Env) {
  return {
    async create(
      user: SessionUser | undefined,
      input: CreateNoteInput,
    ): Promise<Note | { error: string; status: number }> {
      const owner = await resolveOwnerForCreate(env, user);
      if ("error" in owner) {
        return { error: owner.error, status: 401 };
      }

      const scopes = scopesFromInput(env, input);
      if ("error" in scopes) {
        return { error: scopes.error, status: 400 };
      }

      const now = Date.now();
      const id = crypto.randomUUID();
      const shortId = await generateUniqueShortId(env);
      const resolved = await resolveCreateFolder(env, owner.id, input);
      if ("error" in resolved) {
        return resolved;
      }
      const folder = resolved.folder;
      await ensureFolderRow(env, owner.id, folder);
      const markdown = await markdownForCreate(env, owner.id, folder, input);
      const title = titleFromMarkdown(markdown);

      await db(env)
        .prepare(
          `INSERT INTO notes (
             id, short_id, alias, owner_id, title, folder, permission,
             read_scope, write_scope,
             markdown_snapshot, snapshot_updated_at, created_at, updated_at
           ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          shortId,
          owner.id,
          title,
          folder,
          scopes.permission,
          scopes.readScope,
          scopes.writeScope,
          markdown,
          now,
          now,
          now,
        )
        .run();

      const row = await findNoteRow(env, id);
      if (!row) {
        throw new Error("note insert failed");
      }
      return toNote(env, row, user ?? owner);
    },

    async get(idOrShortId: string, user?: SessionUser): Promise<GetNoteResult> {
      const row = await findNoteRow(env, idOrShortId);
      if (!row) {
        return { kind: "not_found" };
      }

      const note = await toNote(env, row, user);
      if (!note.access.flags.canView) {
        return {
          kind: "denied",
          status: viewDeniedHttpStatus(
            { flags: note.access.flags, ownerId: row.owner_id },
            user?.id,
            env,
          ),
        };
      }

      return { kind: "ok", note };
    },

    async listForGuest(): Promise<NoteSummary[]> {
      const rows = await listGuestRows(env);
      return Promise.all(rows.map((row) => toSummary(env, row, undefined)));
    },
    async listForUser(user: SessionUser): Promise<NoteSummary[]> {
      const rows = await listAccessibleRows(env, user);
      return Promise.all(rows.map((row) => toSummary(env, row, user)));
    },

    async remove(
      idOrShortId: string,
      user: SessionUser | undefined,
    ): Promise<MutateNoteResult> {
      const row = await findNoteRow(env, idOrShortId);
      if (!row) {
        return { kind: "not_found" };
      }

      const current = await toNote(env, row, user);
      if (!current.access.flags.canAdmin) {
        return {
          kind: "denied",
          status:
            user === undefined
              ? viewDeniedHttpStatus(
                  { flags: current.access.flags, ownerId: row.owner_id },
                  undefined,
                  env,
                )
              : 403,
        };
      }

      await createImageService(env).deleteAllForNote(row.id);
      await deleteRevisionsForNote(env, row.id);
      await db(env)
        .prepare(
          "DELETE FROM access_grants WHERE target_kind = 'note' AND target_key = ?",
        )
        .bind(row.id)
        .run();
      await db(env)
        .prepare("DELETE FROM notes WHERE id = ?")
        .bind(row.id)
        .run();
      return { kind: "ok", note: current };
    },

    async removeFolder(
      folderId: string,
      user: SessionUser | undefined,
    ): Promise<RemoveFolderResult> {
      const rec = await getFolderById(env, folderId);
      if (!rec) {
        return { kind: "not_found" };
      }
      const denied = folderOwnerDenied(rec.owner_id, user);
      if (denied) {
        return denied;
      }
      if (!rec.folder) {
        return { kind: "denied", status: 403 };
      }

      await deleteOwnedNotesInFolder(env, rec.owner_id, rec.folder);
      await deleteArticleSourcesInFolder(env, rec.owner_id, rec.folder);
      await deleteFolderTree(env, rec.owner_id, rec.folder);
      return { kind: "ok" };
    },

    async renameFolder(
      folderId: string,
      name: string,
      user: SessionUser | undefined,
    ): Promise<RenameFolderResult> {
      const rec = await getFolderById(env, folderId);
      if (!rec) {
        return { kind: "not_found" };
      }
      const validated = await validateRenameFolder(env, rec, name, user);
      if (!("nextPath" in validated)) {
        return validated;
      }

      await rewriteOwnedNoteFolders(
        env,
        rec.owner_id,
        rec.folder,
        validated.nextPath,
      );
      await renameFolderTree(env, rec.owner_id, rec.folder, validated.nextPath);
      await rewriteArticleSourceFolders(
        env,
        rec.owner_id,
        rec.folder,
        validated.nextPath,
      );
      return {
        access: await resolveFolderAccess(
          env,
          rec.owner_id,
          validated.nextPath,
          user,
        ),
        kind: "ok",
      };
    },

    async searchForUser(
      user: SessionUser,
      query: string,
    ): Promise<NoteSearchHit[]> {
      const needle = query.trim().toLowerCase();
      if (!needle) {
        return [];
      }

      const rows = await listAccessibleRows(env, user);
      const hits: NoteSearchHit[] = [];
      for (const row of rows) {
        const titleHit = row.title.toLowerCase().includes(needle);
        const markdown = row.markdown_snapshot ?? "";
        const markdownIndex = markdown.toLowerCase().indexOf(needle);
        if (!titleHit && markdownIndex === -1) {
          continue;
        }
        const summary = await toSummary(env, row, user);
        hits.push({
          ...summary,
          snippet:
            markdownIndex >= 0
              ? excerptSnapshot(markdown, markdownIndex, needle.length)
              : undefined,
        });
      }
      return hits;
    },

    async updateMarkdown(
      idOrShortId: string,
      user: SessionUser | undefined,
      markdown: string,
    ): Promise<MutateNoteResult> {
      const row = await findNoteRow(env, idOrShortId);
      if (!row) {
        return { kind: "not_found" };
      }

      const current = await toNote(env, row, user);
      if (!current.access.flags.canEdit) {
        return {
          kind: "denied",
          status:
            user === undefined
              ? viewDeniedHttpStatus(
                  { flags: current.access.flags, ownerId: row.owner_id },
                  undefined,
                  env,
                )
              : 403,
        };
      }

      const now = Date.now();
      const title = titleFromMarkdown(markdown);
      await db(env)
        .prepare(
          "UPDATE notes SET markdown_snapshot = ?, title = ?, snapshot_updated_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind(markdown, title, now, now, row.id)
        .run();

      const updated = await findNoteRow(env, row.id);
      if (!updated) {
        throw new Error("note update failed");
      }
      return { kind: "ok", note: await toNote(env, updated, user) };
    },

    async updateMeta(
      idOrShortId: string,
      user: SessionUser | undefined,
      input: UpdateNoteMetaInput,
    ): Promise<MutateNoteResult> {
      const row = await findNoteRow(env, idOrShortId);
      if (!row) {
        return { kind: "not_found" };
      }

      const current = await toNote(env, row, user);
      const flags = current.access.flags;

      if (input.title !== undefined && !flags.canEdit) {
        return mutateDenied(env, row.owner_id, flags, user);
      }

      if (hasAdminMetaFields(input) && !flags.canAdmin) {
        return mutateDenied(env, row.owner_id, flags, user);
      }

      const scopes = scopesFromInput(env, input, {
        readScope: parseStoredScope(row.read_scope),
        writeScope: parseStoredScope(row.write_scope),
      });
      if ("error" in scopes) {
        return { error: scopes.error, kind: "bad_request" };
      }

      const next = nextMetaValues(row, input);
      await ensureFolderRow(env, row.owner_id, next.folder);

      const now = Date.now();
      await db(env)
        .prepare(
          `UPDATE notes
           SET title = ?, folder = ?, permission = ?, alias = ?,
               read_scope = ?, write_scope = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          next.title,
          next.folder,
          scopes.permission,
          next.alias,
          scopes.readScope,
          scopes.writeScope,
          now,
          row.id,
        )
        .run();

      const grantError = await replaceNoteGrantsIfNeeded(
        env,
        row,
        input.grants,
      );
      if (grantError) {
        return { error: grantError.error, kind: "bad_request" };
      }

      const updated = await findNoteRow(env, row.id);
      if (!updated) {
        throw new Error("note update failed");
      }
      return { kind: "ok", note: await toNote(env, updated, user) };
    },
  };
}

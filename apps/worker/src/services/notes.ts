import {
  type AccessScope,
  articleMetaFromNote,
  type CreateNoteInput,
  clampWriteScope,
  defaultNoteMarkdown,
  ensureArticleMarkdown,
  type FolderAccess,
  folderContains,
  type GrepResult,
  isAccessScope,
  isGoldLockedAt,
  isNoteLayer,
  isPermissionPreset,
  matchArticleSource,
  type Note,
  type NoteLayer,
  type NoteSearchHit,
  type NoteSearchPage,
  type NoteSummary,
  normalizeFolder,
  type PermissionPreset,
  presetFromScopes,
  rewriteFolderPrefix,
  type SearchScope,
  type SessionUser,
  scopesFromPreset,
  titleFromMarkdown,
  type UpdateNoteMetaInput,
  type WorkspaceSearchResult,
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
  folderViewFlags,
  getFolderById,
  getFolderByPath,
  listPublicFolderCandidates,
  listSharedFolderCandidates,
  type NoteAccessFields,
  noteMatchesFolderGrant,
  parentFolderPath,
  replaceGrants,
  resolveFolderAccess,
  resolveNoteAccess,
} from "./access.ts";
import {
  createArticleService,
  deleteArticleSourcesInFolder,
  escapeLikePattern,
} from "./articles.ts";
import { deleteRevisionsForNote } from "./history.ts";
import { createImageService } from "./images.ts";
import { viewDeniedHttpStatus } from "./permissions.ts";
import { schemeNoteTitlePrefix } from "./schemes.ts";
import { createLineMatcher, type GrepScanOptions, grepRows } from "./search.ts";

export type NoteRow = {
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
  snapshot_updated_at: number | null;
  created_at: number;
  updated_at: number;
  article_meta: string | null;
  layer: string | null;
  gold_unlocked_until: number | null;
};

const SHORT_ID_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ANONYMOUS_OWNER_EMAIL = "anonymous@miyulabmd.local";
export const NOTE_COLUMNS = `id, short_id, alias, owner_id, title, folder, permission, read_scope, write_scope,
                  markdown_snapshot, snapshot_updated_at, created_at, updated_at, article_meta,
                  layer, gold_unlocked_until`;
const NOTE_COLUMNS_N = `n.id, n.short_id, n.alias, n.owner_id, n.title, n.folder, n.permission, n.read_scope, n.write_scope,
                  n.markdown_snapshot, n.snapshot_updated_at, n.created_at, n.updated_at, n.article_meta,
                  n.layer, n.gold_unlocked_until`;

function parseStoredScope(value: string | null): AccessScope | null {
  return value && isAccessScope(value) ? value : null;
}

export function accessFields(row: NoteRow): NoteAccessFields {
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
  // スキームメタは folderId が見える閲覧者にだけ付ける（存在漏洩を folderId と揃える）。
  let folderSchemeId: string | null = null;
  let folderSchemeTitle: string | null = null;
  if (visibleFolderId) {
    const folderRow = await getFolderById(env, visibleFolderId);
    folderSchemeId = folderRow?.scheme_id ?? null;
    folderSchemeTitle = folderRow?.scheme_title ?? null;
  }
  return {
    access: isOwner ? access : { ...access, grants: [], sourceFolder: null },
    alias: row.alias,
    articleMeta: articleMetaFromNote(row.markdown_snapshot, row.article_meta),
    createdAt: row.created_at,
    folder: isOwner ? folder : "",
    folderId: visibleFolderId,
    folderSchemeId,
    folderSchemeTitle,
    goldLocked: isGoldLockedAt(row.layer, row.gold_unlocked_until),
    goldUnlockedUntil: row.gold_unlocked_until ?? null,
    id: row.id,
    layer: isNoteLayer(row.layer ?? "") ? (row.layer as NoteLayer) : "bronze",
    markdown: row.markdown_snapshot,
    ownerId: row.owner_id,
    permission: derivedPermission(access),
    shortId: row.short_id,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

export async function toSummary(
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
  const before = await findNoteRow(env, noteId);
  const now = Date.now();
  const title = titleFromMarkdown(markdown);
  await db(env)
    .prepare(
      "UPDATE notes SET markdown_snapshot = ?, title = ?, snapshot_updated_at = ?, updated_at = ? WHERE id = ?",
    )
    .bind(markdown, title, now, now, noteId)
    .run();
  const after = await findNoteRow(env, noteId);
  if (after) {
    await syncNoteLinks(env, after, before ?? undefined);
  }
}

/**
 * リンク索引を差し替える。作成・本文更新・メタ更新・snapshot 書き戻し時に呼ぶ。
 * `before` を渡すと、タイトル/フォルダ/別名が変わった場合に他ノートからの
 * リンクも再解決する。索引は再構築可能なので失敗しても本体処理は継続する。
 */
export async function syncNoteLinks(
  env: Env,
  after: NoteRow,
  before?: NoteRow,
): Promise<void> {
  try {
    const { reindexLinksToNote, reindexNoteLinks } = await import("./links.ts");
    await reindexNoteLinks(env, after);
    const identityChanged =
      !before ||
      before.title !== after.title ||
      before.folder !== after.folder ||
      before.alias !== after.alias;
    if (identityChanged) {
      await reindexLinksToNote(
        env,
        after,
        before ?? { alias: null, folder: "", title: "" },
      );
    }
  } catch (error) {
    console.error("note_links reindex failed", error);
  }
}

export function findNoteRow(
  env: Env,
  idOrShortId: string,
): Promise<NoteRow | null> {
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

export async function listAccessibleRows(
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

function excerptSnapshot(text: string, start: number, length: number): string {
  const radius = 80;
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, start + length + radius);
  const prefix = from > 0 ? "…" : "";
  const suffix = to < text.length ? "…" : "";
  return `${prefix}${text.slice(from, to)}${suffix}`;
}

const SEARCH_DEFAULT_LIMIT = 50;
const SEARCH_MAX_LIMIT = 200;
const WORKSPACE_SEARCH_NOTE_LIMIT = 50;

function clampSearchLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) {
    return SEARCH_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(Math.trunc(limit), SEARCH_MAX_LIMIT));
}

function parseSearchCursor(cursor: string | undefined): number {
  const offset = Number(cursor);
  return Number.isInteger(offset) && offset >= 0 ? offset : 0;
}

type SearchRowsResult = { kind: "ok"; rows: NoteRow[] } | { kind: "not_found" };

/**
 * Permission-filtered candidate rows for search/grep, optionally restricted to
 * a folder subtree. The folder check hides folders the user cannot view.
 */
async function rowsForSearch(
  env: Env,
  user: SessionUser | undefined,
  folderId: string | undefined,
): Promise<SearchRowsResult> {
  const rows = user
    ? await listAccessibleRows(env, user)
    : await listGuestRows(env);
  if (!folderId) {
    return { kind: "ok", rows };
  }
  const rec = await getFolderById(env, folderId);
  if (!rec) {
    return { kind: "not_found" };
  }
  const flags = await folderViewFlags(env, rec.owner_id, rec.folder, user);
  if (!flags.canView) {
    return { kind: "not_found" };
  }
  const prefix = `${rec.folder}/`;
  return {
    kind: "ok",
    rows: rows.filter(
      (row) =>
        row.owner_id === rec.owner_id &&
        (rec.folder === "" ||
          row.folder === rec.folder ||
          row.folder.startsWith(prefix)),
    ),
  };
}

function filterSearchRows(
  rows: readonly NoteRow[],
  query: string,
  scope: SearchScope,
): NoteRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  return rows.filter((row) => {
    if (scope !== "body" && row.title.toLowerCase().includes(needle)) {
      return true;
    }
    if (scope === "title") {
      return false;
    }
    return (row.markdown_snapshot ?? "").toLowerCase().includes(needle);
  });
}

async function searchHitForRow(
  env: Env,
  row: NoteRow,
  user: SessionUser | undefined,
  needle: string,
): Promise<NoteSearchHit> {
  const summary = await toSummary(env, row, user);
  const markdown = row.markdown_snapshot ?? "";
  const markdownIndex = markdown.toLowerCase().indexOf(needle);
  return {
    ...summary,
    snippet:
      markdownIndex >= 0
        ? excerptSnapshot(markdown, markdownIndex, needle.length)
        : undefined,
  };
}

export type GrepNotesResult =
  | ({ kind: "ok" } & GrepResult)
  | { kind: "not_found" }
  | { kind: "bad_request"; error: string };

export type GrepNotesOptions = {
  pattern: string;
  caseSensitive?: boolean;
  /** Defaults to a fixed-string scan; false enables a JS regex pattern. */
  fixedString?: boolean;
  folderId?: string;
} & GrepScanOptions;

export type GetNoteResult =
  | { kind: "ok"; note: Note }
  | { kind: "not_found" }
  | { kind: "denied"; status: 401 | 403 };

export type MutateNoteResult =
  | { kind: "ok"; note: Note }
  | { kind: "not_found" }
  | { kind: "denied"; status: 401 | 403; code?: string }
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

async function folderNoteVisibleTo(
  env: Env,
  rec: { owner_id: string; folder: string },
  row: NoteRow,
  isOwner: boolean,
  user: SessionUser,
): Promise<boolean> {
  if (isOwner) {
    return true;
  }
  const access = await resolveNoteAccess(env, accessFields(row), user);
  if (!access.flags.canView) {
    return false;
  }
  // 既知のフォルダから継承したノートは列挙できる。それ以外は発見可能性が必要。
  const inheritsKnownFolder =
    access.sourceFolder !== null &&
    folderContains(access.sourceFolder, rec.folder);
  return inheritsKnownFolder || canDiscoverAccess(access, rec.owner_id, user);
}

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
  const prefix = await schemeNoteTitlePrefix(env, ownerId, folder, Date.now());
  const baseTitle = `${prefix ?? ""}${input.title?.trim() || "無題"}`;
  let markdown = input.markdown ?? defaultNoteMarkdown(baseTitle);
  const sources = await createArticleService(env).listSources(ownerId);
  const source = matchArticleSource(folder, sources);
  if (source) {
    markdown = ensureArticleMarkdown(markdown, source.schema, baseTitle);
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
    await db(env)
      .prepare("DELETE FROM note_links WHERE src_note_id = ?")
      .bind(row.id)
      .run();
    await db(env)
      .prepare(
        "UPDATE note_links SET dest_note_id = NULL, dest_status = 'missing', updated_at = ? WHERE dest_note_id = ?",
      )
      .bind(Date.now(), row.id)
      .run();
  }
}

/**
 * フォルダ配下のパスを一括書き換える。notes/folders/folder_policies/
 * access_grants/article_sources を prefix rewrite し、移動したノートと
 * それを指すリンクを再索引する。renameFolder と move 系サービスで共有。
 */
type RelocateRows = {
  folderRows: { id: string; folder: string }[];
  grantRows: { id: string; target_key: string }[];
  noteRows: { id: string; folder: string }[];
  policyRows: { folder: string }[];
  sourceRows: { id: string; folder: string }[];
};

function prefixUpdateStatements<Row>(
  rows: Row[],
  from: string,
  to: string,
  pathOf: (row: Row) => string,
  build: (next: string, row: Row) => D1PreparedStatement,
): D1PreparedStatement[] {
  const statements: D1PreparedStatement[] = [];
  for (const row of rows) {
    const next = rewriteFolderPrefix(pathOf(row), from, to);
    if (next !== null) {
      statements.push(build(next, row));
    }
  }
  return statements;
}

function relocationStatements(
  d1: D1Database,
  ownerId: string,
  from: string,
  to: string,
  rows: RelocateRows,
): D1PreparedStatement[] {
  const folderIdByPath = new Map<string, string>();
  for (const row of rows.folderRows) {
    folderIdByPath.set(
      rewriteFolderPrefix(row.folder, from, to) ?? row.folder,
      row.id,
    );
  }
  return [
    ...prefixUpdateStatements(
      rows.folderRows,
      from,
      to,
      (row) => row.folder,
      (next, row) =>
        d1
          .prepare(
            "UPDATE folders SET folder = ? WHERE owner_id = ? AND folder = ?",
          )
          .bind(next, ownerId, row.folder),
    ),
    ...prefixUpdateStatements(
      rows.noteRows,
      from,
      to,
      (row) => row.folder ?? "",
      (next, row) =>
        d1
          .prepare("UPDATE notes SET folder = ? WHERE id = ?")
          .bind(next, row.id),
    ),
    ...prefixUpdateStatements(
      rows.policyRows,
      from,
      to,
      (row) => row.folder,
      (next, row) =>
        d1
          .prepare(
            "UPDATE folder_policies SET folder = ? WHERE owner_id = ? AND folder = ?",
          )
          .bind(next, ownerId, row.folder),
    ),
    ...prefixUpdateStatements(
      rows.grantRows,
      from,
      to,
      (row) => row.target_key,
      (next, row) =>
        d1
          .prepare("UPDATE access_grants SET target_key = ? WHERE id = ?")
          .bind(next, row.id),
    ),
    ...prefixUpdateStatements(
      rows.sourceRows,
      from,
      to,
      (row) => row.folder,
      (next, row) =>
        d1
          .prepare(
            "UPDATE article_sources SET folder = ?, folder_id = ? WHERE id = ?",
          )
          .bind(next, folderIdByPath.get(next) ?? null, row.id),
    ),
  ];
}

/**
 * Rewrites a folder path prefix across every table that stores it. All path
 * rewrites run as one D1 batch so a mid-way failure cannot leave the tree
 * half-moved; the derived link index is refreshed afterwards.
 */
export async function relocateFolderTree(
  env: Env,
  ownerId: string,
  from: string,
  to: string,
): Promise<void> {
  if (!(from && to) || from === to) {
    return;
  }
  const d1 = db(env);
  const [noteRows, folderRows, policyRows, grantRows, sourceRows] =
    await Promise.all([
      d1
        .prepare("SELECT id, folder FROM notes WHERE owner_id = ?")
        .bind(ownerId)
        .all<{ id: string; folder: string }>(),
      d1
        .prepare("SELECT id, folder FROM folders WHERE owner_id = ?")
        .bind(ownerId)
        .all<{ id: string; folder: string }>(),
      d1
        .prepare("SELECT folder FROM folder_policies WHERE owner_id = ?")
        .bind(ownerId)
        .all<{ folder: string }>(),
      d1
        .prepare(
          "SELECT id, target_key FROM access_grants WHERE owner_id = ? AND target_kind = 'folder'",
        )
        .bind(ownerId)
        .all<{ id: string; target_key: string }>(),
      d1
        .prepare("SELECT id, folder FROM article_sources WHERE owner_id = ?")
        .bind(ownerId)
        .all<{ id: string; folder: string }>(),
    ]);

  const statements = relocationStatements(d1, ownerId, from, to, {
    folderRows: folderRows.results ?? [],
    grantRows: grantRows.results ?? [],
    noteRows: noteRows.results ?? [],
    policyRows: policyRows.results ?? [],
    sourceRows: sourceRows.results ?? [],
  });
  if (statements.length > 0) {
    await d1.batch(statements);
  }

  const moved = await d1
    .prepare(
      `SELECT ${NOTE_COLUMNS} FROM notes
       WHERE owner_id = ? AND (folder = ? OR folder LIKE ? ESCAPE '\\')`,
    )
    .bind(ownerId, to, `${escapeLikePattern(to)}/%`)
    .all<NoteRow>();
  for (const movedRow of moved.results ?? []) {
    const prevFolder =
      rewriteFolderPrefix(movedRow.folder ?? "", to, from) ?? from;
    await syncNoteLinks(env, movedRow, { ...movedRow, folder: prevFolder });
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
      await syncNoteLinks(env, row);
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

    async grep(
      user: SessionUser | undefined,
      options: GrepNotesOptions,
    ): Promise<GrepNotesResult> {
      const matcher = createLineMatcher(options.pattern, {
        caseSensitive: options.caseSensitive,
        fixedString: options.fixedString,
      });
      if (matcher.kind !== "ok") {
        return matcher;
      }
      const scoped = await rowsForSearch(env, user, options.folderId);
      if (scoped.kind !== "ok") {
        return scoped;
      }
      return { kind: "ok", ...grepRows(scoped.rows, matcher.matcher, options) };
    },
    async listFolderNotes(
      user: SessionUser,
      folderId: string,
      recursive = false,
    ): Promise<
      | { kind: "ok"; notes: NoteSummary[] }
      | { kind: "not_found" }
      | { kind: "denied"; status: 401 | 403 }
    > {
      const rec = await getFolderById(env, folderId);
      if (!rec) {
        return { kind: "not_found" };
      }
      const flags = await folderViewFlags(env, rec.owner_id, rec.folder, user);
      if (!flags.canView) {
        return { kind: "not_found" };
      }

      const rows = recursive
        ? await db(env)
            .prepare(
              `SELECT ${NOTE_COLUMNS} FROM notes
                 WHERE owner_id = ? AND (folder = ? OR folder LIKE ? ESCAPE '\\')
                 ORDER BY updated_at DESC`,
            )
            .bind(
              rec.owner_id,
              rec.folder,
              `${escapeLikePattern(rec.folder)}/%`,
            )
            .all<NoteRow>()
        : await db(env)
            .prepare(
              `SELECT ${NOTE_COLUMNS} FROM notes
                 WHERE owner_id = ? AND folder = ?
                 ORDER BY updated_at DESC`,
            )
            .bind(rec.owner_id, rec.folder)
            .all<NoteRow>();

      const isOwner = user.id === rec.owner_id;
      const summaries: NoteSummary[] = [];
      for (const row of rows.results ?? []) {
        if (await folderNoteVisibleTo(env, rec, row, isOwner, user)) {
          summaries.push(await toSummary(env, row, user));
        }
      }
      return { kind: "ok", notes: summaries };
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
      await db(env)
        .prepare("DELETE FROM note_links WHERE src_note_id = ?")
        .bind(row.id)
        .run();
      await db(env)
        .prepare(
          "UPDATE note_links SET dest_note_id = NULL, dest_status = 'missing', updated_at = ? WHERE dest_note_id = ?",
        )
        .bind(Date.now(), row.id)
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

      await relocateFolderTree(
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
      const rows = await listAccessibleRows(env, user);
      const needle = query.trim().toLowerCase();
      return Promise.all(
        filterSearchRows(rows, query, "all").map((row) =>
          searchHitForRow(env, row, user, needle),
        ),
      );
    },

    async searchNotes(
      user: SessionUser | undefined,
      options: {
        query: string;
        scope?: SearchScope;
        folderId?: string;
        limit?: number;
        cursor?: string;
      },
    ): Promise<({ kind: "ok" } & NoteSearchPage) | { kind: "not_found" }> {
      const scoped = await rowsForSearch(env, user, options.folderId);
      if (scoped.kind !== "ok") {
        return scoped;
      }
      const needle = options.query.trim().toLowerCase();
      const matched = filterSearchRows(
        scoped.rows,
        options.query,
        options.scope ?? "all",
      );
      const limit = clampSearchLimit(options.limit);
      const offset = parseSearchCursor(options.cursor);
      const pageRows = matched.slice(offset, offset + limit);
      const notes = await Promise.all(
        pageRows.map((row) => searchHitForRow(env, row, user, needle)),
      );
      const nextCursor =
        offset + pageRows.length < matched.length
          ? String(offset + pageRows.length)
          : null;
      return { kind: "ok", nextCursor, notes };
    },

    async searchWorkspace(
      user: SessionUser | undefined,
      query: string,
      options: { contextAfter?: number; contextBefore?: number } = {},
    ): Promise<WorkspaceSearchResult> {
      const trimmed = query.trim();
      const scoped = await rowsForSearch(env, user, undefined);
      const rows = scoped.kind === "ok" ? scoped.rows : [];
      const needle = trimmed.toLowerCase();
      const matched = filterSearchRows(rows, trimmed, "all").slice(
        0,
        WORKSPACE_SEARCH_NOTE_LIMIT,
      );
      const notes = await Promise.all(
        matched.map((row) => searchHitForRow(env, row, user, needle)),
      );
      const matcher = createLineMatcher(trimmed, {});
      const grep =
        matcher.kind === "ok"
          ? grepRows(rows, matcher.matcher, options)
          : { matches: [], scannedNotes: 0, truncated: false };
      return { grep, notes, query: trimmed };
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
      // gold 層はポリシーロック: unlock_gold_for_edit の期限中のみ編集可。
      if (isGoldLockedAt(row.layer, row.gold_unlocked_until)) {
        return { code: "gold_locked", kind: "denied", status: 403 };
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
      await syncNoteLinks(env, updated, row);
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
      await syncNoteLinks(env, updated, row);
      return { kind: "ok", note: await toNote(env, updated, user) };
    },
  };
}

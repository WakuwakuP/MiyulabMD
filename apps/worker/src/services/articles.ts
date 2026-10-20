import {
  type AccessScope,
  type ArticleCollection,
  type ArticleEntry,
  type ArticleEntryPage,
  type ArticleSchemaField,
  type ArticleSource,
  type ArticleSourceStatus,
  type ArticleUpdateAudience,
  articleEditUrl,
  articleMetaFromNote,
  articleSlug,
  canDispatchArticleSource,
  canOfferArticleDispatch,
  folderMatchesSource,
  isAccessScope,
  isArticleSourceDirty,
  isArticleUpdateAudience,
  matchArticleSource,
  mergeArticleData,
  parseArticleSchema,
  readArticleFrontmatter,
  resolveArticleListFolder,
  type SessionUser,
} from "@miyulabmd/shared";

import { db } from "../db/client.ts";
import {
  ensureFolderRow,
  folderName,
  folderViewFlags,
  getFolderById,
  listSharedFolderCandidates,
  resolveNoteAccess,
} from "./access.ts";
import {
  canEditSubject,
  driveRoleFor,
  isSharedDrive,
} from "./drive-membership.ts";
import { folderSubtreeFilter } from "./folder-path-sql.ts";

type SourceRow = {
  id: string;
  owner_id: string;
  folder: string;
  folder_id: string | null;
  name: string;
  schema_json: string;
  webhook_url: string | null;
  webhook_authorization: string | null;
  update_audience?: string | null;
  last_dispatched_at: number | null;
  created_at: number;
  updated_at: number;
};

type NoteArticleRow = {
  id: string;
  short_id: string;
  alias: string | null;
  title: string;
  folder: string;
  markdown_snapshot: string;
  article_meta: string | null;
  created_at: number;
  updated_at: number;
};

export type ArticleSourceWrite = {
  name?: string;
  folder?: string;
  folderId?: string | null;
  schema?: unknown;
  webhookUrl?: string | null;
  webhookAuthorization?: string | null;
  updateAudience?: ArticleUpdateAudience;
};

function parseSchemaJson(raw: string): ArticleSchemaField[] {
  try {
    const parsed = parseArticleSchema(JSON.parse(raw) as unknown);
    return "error" in parsed ? [] : parsed;
  } catch {
    return [];
  }
}

function storedAudience(
  value: string | null | undefined,
): ArticleUpdateAudience {
  return value === "editors" ? "editors" : "self";
}

function presentSource(row: SourceRow, folderLabel?: string): ArticleSource {
  return {
    createdAt: row.created_at,
    folder: folderLabel ?? row.folder,
    folderId: row.folder_id,
    id: row.id,
    lastDispatchedAt: row.last_dispatched_at,
    name: row.name,
    schema: parseSchemaJson(row.schema_json),
    updateAudience: storedAudience(row.update_audience),
    updatedAt: row.updated_at,
    webhookAuthorizationSet: Boolean(row.webhook_authorization),
    webhookUrl: row.webhook_url,
  };
}

function presentForUser(row: SourceRow, userId: string): ArticleSource {
  if (userId === row.owner_id) {
    return presentSource(row);
  }
  return presentSource(row, folderName(row.folder));
}

function presentCollection(row: SourceRow): ArticleCollection {
  return {
    folder: row.folder,
    id: row.id,
    name: row.name,
    schema: parseSchemaJson(row.schema_json),
  };
}

export function isAllowedWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") {
      return true;
    }
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

async function resolveFolderPath(
  env: Env,
  ownerId: string,
  input: { folder?: string; folderId?: string | null },
): Promise<{ folder: string; folderId: string | null } | { error: string }> {
  if (input.folderId) {
    const rec = await getFolderById(env, input.folderId);
    if (!rec || rec.owner_id !== ownerId) {
      return { error: "フォルダが見つかりません" };
    }
    if (!rec.folder) {
      return { error: "マイドライブは記事ソースにできません" };
    }
    return { folder: rec.folder, folderId: rec.id };
  }
  if (input.folder === undefined) {
    return { error: "folder または folderId が必要です" };
  }
  const folder = input.folder.trim().replace(/^\/+|\/+$/g, "");
  if (!folder) {
    return { error: "マイドライブは記事ソースにできません" };
  }
  const folderId = await ensureFolderRow(env, ownerId, folder);
  return { folder, folderId };
}

function loadSource(
  env: Env,
  ownerId: string,
  id: string,
): Promise<SourceRow | null> {
  return db(env)
    .prepare("SELECT * FROM article_sources WHERE id = ? AND owner_id = ?")
    .bind(id, ownerId)
    .first<SourceRow>();
}

function loadSourceById(env: Env, id: string): Promise<SourceRow | null> {
  return db(env)
    .prepare("SELECT * FROM article_sources WHERE id = ?")
    .bind(id)
    .first<SourceRow>();
}

function storedScope(value: string | null): AccessScope | null {
  return value && isAccessScope(value) ? value : null;
}

/** 共有ドライブなら管理者かどうか。マイドライブなら null。 */
async function sharedDriveActor(
  env: Env,
  ownerId: string,
  user: SessionUser,
): Promise<{ isManager: boolean } | null> {
  if (!(await isSharedDrive(env, ownerId))) {
    return null;
  }
  return { isManager: (await driveRoleFor(env, ownerId, user)) === "manager" };
}

async function userCanDispatchSource(
  env: Env,
  user: SessionUser,
  row: SourceRow,
): Promise<boolean> {
  const drive = await sharedDriveActor(env, row.owner_id, user);
  if (drive) {
    return canDispatchArticleSource({
      audience: storedAudience(row.update_audience),
      canEdit: await canEditSubject(env, row.owner_id, user),
      isOwner: drive.isManager,
    });
  }
  const flags = await folderViewFlags(env, row.owner_id, row.folder, user);
  return canDispatchArticleSource({
    audience: storedAudience(row.update_audience),
    canEdit: flags.canEdit,
    isOwner: user.id === row.owner_id,
  });
}

async function canManageSource(
  env: Env,
  user: SessionUser,
  row: SourceRow,
): Promise<boolean> {
  const drive = await sharedDriveActor(env, row.owner_id, user);
  if (drive) {
    return canDispatchArticleSource({
      audience: storedAudience(row.update_audience),
      canEdit: await canEditSubject(env, row.owner_id, user),
      isOwner: drive.isManager,
    });
  }
  if (user.id === row.owner_id) {
    return true;
  }
  if (storedAudience(row.update_audience) !== "editors") {
    return false;
  }
  const flags = await folderViewFlags(env, row.owner_id, row.folder, user);
  return flags.canEdit;
}

type SourceWriteError = { error: string; status: number };

function createWebhookUrl(
  input: ArticleSourceWrite,
): { webhookUrl: string | null } | SourceWriteError {
  const webhookUrl =
    input.webhookUrl === undefined || input.webhookUrl === null
      ? null
      : input.webhookUrl.trim();
  if (webhookUrl && !isAllowedWebhookUrl(webhookUrl)) {
    return {
      error: "webhookUrl は https である必要があります",
      status: 400,
    };
  }
  return { webhookUrl };
}

function isWriteError(
  value: ArticleUpdateAudience | SourceWriteError,
): value is SourceWriteError {
  return typeof value !== "string";
}

function audienceFromInput(
  value: unknown,
  fallback: ArticleUpdateAudience,
): ArticleUpdateAudience | SourceWriteError {
  if (value === undefined) {
    return fallback;
  }
  if (isArticleUpdateAudience(value)) {
    return value;
  }
  return {
    error: "updateAudience は self または editors です",
    status: 400,
  };
}

function rejectForeignSelf(
  userId: string,
  ownerId: string,
  drive: { isManager: boolean } | null,
  audience: ArticleUpdateAudience,
): SourceWriteError | null {
  if (audience === "editors") {
    return null;
  }
  if (drive) {
    if (drive.isManager) {
      return null;
    }
    return {
      error: "自分のみにできるのは共有ドライブの管理者です",
      status: 403,
    };
  }
  if (userId === ownerId) {
    return null;
  }
  return {
    error: "自分のみにできるのはフォルダの所有者です",
    status: 403,
  };
}

async function assertCanUseFolder(
  env: Env,
  user: SessionUser,
  ownerId: string,
  folder: string,
): Promise<SourceWriteError | null> {
  if (user.id === ownerId) {
    return null;
  }
  if (await isSharedDrive(env, ownerId)) {
    if (await canEditSubject(env, ownerId, user)) {
      return null;
    }
    return { error: "Forbidden", status: 403 };
  }
  const flags = await folderViewFlags(env, ownerId, folder, user);
  if (!flags.canEdit) {
    return { error: "フォルダが見つかりません", status: 404 };
  }
  return null;
}

type SourcePlacement = {
  ownerId: string;
  folder: string;
  folderId: string | null;
};

async function resolvePlacement(
  env: Env,
  user: SessionUser,
  requestedOwnerId: string,
  input: { folder?: string; folderId?: string | null },
): Promise<SourcePlacement | SourceWriteError> {
  if (input.folderId) {
    const rec = await getFolderById(env, input.folderId);
    if (!rec?.folder) {
      return { error: "フォルダが見つかりません", status: 404 };
    }
    const denied = await assertCanUseFolder(
      env,
      user,
      rec.owner_id,
      rec.folder,
    );
    if (denied) {
      return denied;
    }
    if (requestedOwnerId !== user.id && requestedOwnerId !== rec.owner_id) {
      return { error: "フォルダが見つかりません", status: 404 };
    }
    return { folder: rec.folder, folderId: rec.id, ownerId: rec.owner_id };
  }
  const resolved = await resolveFolderPath(env, requestedOwnerId, input);
  if ("error" in resolved) {
    return { error: resolved.error, status: 400 };
  }
  const denied = await assertCanUseFolder(
    env,
    user,
    requestedOwnerId,
    resolved.folder,
  );
  if (denied) {
    return denied;
  }
  return {
    folder: resolved.folder,
    folderId: resolved.folderId,
    ownerId: requestedOwnerId,
  };
}

async function resolveSourcePlacementUpdate(
  env: Env,
  user: SessionUser,
  row: SourceRow,
  input: ArticleSourceWrite,
): Promise<SourcePlacement | SourceWriteError> {
  if (input.folder === undefined && input.folderId === undefined) {
    return {
      folder: row.folder,
      folderId: row.folder_id,
      ownerId: row.owner_id,
    };
  }
  const foreign =
    user.id !== row.owner_id && !(await isSharedDrive(env, row.owner_id));
  if (foreign && input.folderId === undefined) {
    return {
      error: "共有フォルダの変更はフォルダ ID で指定してください",
      status: 400,
    };
  }
  const placed = await resolvePlacement(env, user, row.owner_id, input);
  if ("error" in placed) {
    return placed;
  }
  if (placed.ownerId !== row.owner_id) {
    return { error: "別の所有者のフォルダには移せません", status: 400 };
  }
  return placed;
}

function resolveSourceSchemaUpdate(
  row: SourceRow,
  input: ArticleSourceWrite,
): { schemaJson: string } | SourceWriteError {
  if (input.schema === undefined) {
    return { schemaJson: row.schema_json };
  }
  const schema = parseArticleSchema(input.schema);
  if ("error" in schema) {
    return { error: schema.error, status: 400 };
  }
  return { schemaJson: JSON.stringify(schema) };
}

function resolveSourceNameUpdate(
  row: SourceRow,
  input: ArticleSourceWrite,
): { name: string } | SourceWriteError {
  const name = input.name === undefined ? row.name : input.name.trim();
  if (!name) {
    return { error: "name が必要です", status: 400 };
  }
  return { name };
}

function resolveSourceWebhookUrlUpdate(
  row: SourceRow,
  input: ArticleSourceWrite,
): { webhookUrl: string | null } | SourceWriteError {
  if (input.webhookUrl === undefined) {
    return { webhookUrl: row.webhook_url };
  }
  const webhookUrl = input.webhookUrl?.trim() || null;
  if (webhookUrl && !isAllowedWebhookUrl(webhookUrl)) {
    return {
      error: "webhookUrl は https である必要があります",
      status: 400,
    };
  }
  return { webhookUrl };
}

function resolveSourceWebhookAuthUpdate(
  row: SourceRow,
  input: ArticleSourceWrite,
  webhookUrl: string | null,
): string | null {
  if (input.webhookAuthorization !== undefined) {
    return input.webhookAuthorization?.trim() || null;
  }
  if (webhookUrl !== row.webhook_url) {
    return null;
  }
  return row.webhook_authorization;
}

async function sourceFolderConflict(
  env: Env,
  ownerId: string,
  id: string,
  folder: string,
  previousFolder: string,
): Promise<SourceWriteError | null> {
  if (folder === previousFolder) {
    return null;
  }
  const conflict = await db(env)
    .prepare(
      "SELECT id FROM article_sources WHERE owner_id = ? AND folder = ? AND id != ?",
    )
    .bind(ownerId, folder, id)
    .first<{ id: string }>();
  if (conflict) {
    return {
      error: "このディレクトリは既に登録されています",
      status: 409,
    };
  }
  return null;
}

export function sourceNoteFilter(folder: string) {
  return folderSubtreeFilter(folder);
}

/** @deprecated D1 LIKE は 50 バイト上限。子孫判定は folderSubtreeFilter を使う。 */
export function escapeLikePattern(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

async function maxNoteUpdatedAt(
  env: Env,
  ownerId: string,
  folder: string,
): Promise<number | null> {
  const filter = sourceNoteFilter(folder);
  const row = await db(env)
    .prepare(
      `SELECT MAX(updated_at) AS max_updated
       FROM notes
       WHERE owner_id = ? AND ${filter.sql}`,
    )
    .bind(ownerId, ...filter.binds)
    .first<{ max_updated: number | null }>();
  return row?.max_updated ?? null;
}

function toEntry(
  row: NoteArticleRow,
  schema: ArticleSchemaField[],
  origin: string,
  includeMarkdown: boolean,
): ArticleEntry {
  const frontmatter = readArticleFrontmatter(row.markdown_snapshot);
  const data = mergeArticleData({
    noteMeta: articleMetaFromNote(row.markdown_snapshot, row.article_meta),
    schema,
    title: row.title,
  });
  const slug = articleSlug(row.alias, row.short_id);
  const entry: ArticleEntry = {
    createdAt: row.created_at,
    data,
    editUrl: articleEditUrl(origin, row.short_id),
    folder: row.folder,
    id: row.id,
    slug,
    title: typeof data.title === "string" ? data.title : row.title,
    updatedAt: row.updated_at,
  };
  if (includeMarkdown) {
    entry.markdown = frontmatter.body;
  }
  return entry;
}

async function dispatchTargetForFolder(
  env: Env,
  user: SessionUser,
  ownerId: string,
  folder: string,
): Promise<{ id: string; name: string } | null> {
  const drive = await sharedDriveActor(env, ownerId, user);
  if (
    drive &&
    !drive.isManager &&
    !(await canEditSubject(env, ownerId, user))
  ) {
    return null;
  }
  const opened = await folderViewFlags(env, ownerId, folder, user);
  if (!opened.canView) {
    return null;
  }
  const rows = await db(env)
    .prepare("SELECT * FROM article_sources WHERE owner_id = ?")
    .bind(ownerId)
    .all<SourceRow>();
  const match = matchArticleSource(
    folder,
    (rows.results ?? []).map((row) => presentSource(row)),
  );
  if (!match) {
    return null;
  }
  const row = (rows.results ?? []).find((item) => item.id === match.id);
  if (!row) {
    return null;
  }
  const sourceFlags = await folderViewFlags(
    env,
    row.owner_id,
    row.folder,
    user,
  );
  if (
    !canOfferArticleDispatch({
      audience: storedAudience(row.update_audience),
      isOwner: Boolean(drive?.isManager) || user.id === row.owner_id,
      openedCanView: opened.canView,
      sourceCanEdit: sourceFlags.canEdit,
    })
  ) {
    return null;
  }
  return { id: match.id, name: match.name };
}

async function dispatchTargetForNote(
  env: Env,
  user: SessionUser,
  noteId: string,
): Promise<{ id: string; name: string } | null> {
  const row = await db(env)
    .prepare(
      `SELECT id, owner_id, folder, read_scope, write_scope
       FROM notes WHERE id = ?`,
    )
    .bind(noteId)
    .first<{
      id: string;
      owner_id: string;
      folder: string;
      read_scope: string | null;
      write_scope: string | null;
    }>();
  if (!row) {
    return null;
  }
  if (
    (await isSharedDrive(env, row.owner_id)) &&
    !(await canEditSubject(env, row.owner_id, user))
  ) {
    return null;
  }
  const access = await resolveNoteAccess(
    env,
    {
      folder: row.folder,
      id: row.id,
      ownerId: row.owner_id,
      readScope: storedScope(row.read_scope),
      writeScope: storedScope(row.write_scope),
    },
    user,
  );
  if (!access.flags.canView) {
    return null;
  }
  return dispatchTargetForFolder(env, user, row.owner_id, row.folder);
}

async function editableSharedOwnerIds(
  env: Env,
  user: SessionUser,
): Promise<string[]> {
  const candidates = await listSharedFolderCandidates(env, user);
  const owners = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.ownerId === user.id || !candidate.folder) {
      continue;
    }
    const flags = await folderViewFlags(
      env,
      candidate.ownerId,
      candidate.folder,
      user,
    );
    if (flags.canEdit) {
      owners.add(candidate.ownerId);
    }
  }
  return [...owners];
}

async function sharedSourcesForOwner(
  env: Env,
  user: SessionUser,
  ownerId: string,
): Promise<ArticleSource[]> {
  const rows = await db(env)
    .prepare("SELECT * FROM article_sources WHERE owner_id = ? ORDER BY folder")
    .bind(ownerId)
    .all<SourceRow>();
  const sources: ArticleSource[] = [];
  for (const row of rows.results ?? []) {
    if (storedAudience(row.update_audience) !== "editors") {
      continue;
    }
    const flags = await folderViewFlags(env, row.owner_id, row.folder, user);
    if (flags.canEdit) {
      sources.push(presentSource(row, folderName(row.folder)));
    }
  }
  return sources;
}

type PreparedSource = {
  audience: ArticleUpdateAudience;
  name: string;
  placed: SourcePlacement;
  schemaJson: string;
  webhookAuthorization: string | null;
  webhookUrl: string | null;
};

async function audienceForOwner(
  env: Env,
  user: SessionUser,
  ownerId: string,
  value: unknown,
  fallback: ArticleUpdateAudience,
): Promise<ArticleUpdateAudience | SourceWriteError> {
  const audience = audienceFromInput(value, fallback);
  if (isWriteError(audience)) {
    return audience;
  }
  const drive = await sharedDriveActor(env, ownerId, user);
  const rejected = rejectForeignSelf(user.id, ownerId, drive, audience);
  if (rejected && value === undefined) {
    return "editors";
  }
  return rejected ?? audience;
}

async function prepareNewSource(
  env: Env,
  user: SessionUser,
  requestedOwnerId: string,
  input: ArticleSourceWrite,
): Promise<PreparedSource | SourceWriteError> {
  const name = input.name?.trim();
  if (!name) {
    return { error: "name が必要です", status: 400 };
  }
  const placed = await resolvePlacement(env, user, requestedOwnerId, input);
  if ("error" in placed) {
    return placed;
  }
  const schema = parseArticleSchema(input.schema ?? []);
  if ("error" in schema) {
    return { error: schema.error, status: 400 };
  }
  const webhook = createWebhookUrl(input);
  if ("error" in webhook) {
    return webhook;
  }
  const audience = await audienceForOwner(
    env,
    user,
    placed.ownerId,
    input.updateAudience,
    "self",
  );
  if (isWriteError(audience)) {
    return audience;
  }
  return {
    audience,
    name,
    placed,
    schemaJson: JSON.stringify(schema),
    webhookAuthorization: input.webhookAuthorization?.trim() || null,
    webhookUrl: webhook.webhookUrl,
  };
}

type PreparedUpdate = {
  audience: ArticleUpdateAudience;
  folder: SourcePlacement;
  name: string;
  schemaJson: string;
  webhookAuthorization: string | null;
  webhookUrl: string | null;
};

async function prepareSourceUpdate(
  env: Env,
  user: SessionUser,
  row: SourceRow,
  input: ArticleSourceWrite,
): Promise<PreparedUpdate | SourceWriteError> {
  const folder = await resolveSourcePlacementUpdate(env, user, row, input);
  if ("error" in folder) {
    return folder;
  }
  const schema = resolveSourceSchemaUpdate(row, input);
  if ("error" in schema) {
    return schema;
  }
  const name = resolveSourceNameUpdate(row, input);
  if ("error" in name) {
    return name;
  }
  const webhook = resolveSourceWebhookUrlUpdate(row, input);
  if ("error" in webhook) {
    return webhook;
  }
  const audience = await audienceForOwner(
    env,
    user,
    row.owner_id,
    input.updateAudience,
    storedAudience(row.update_audience),
  );
  if (isWriteError(audience)) {
    return audience;
  }
  const conflict = await sourceFolderConflict(
    env,
    row.owner_id,
    row.id,
    folder.folder,
    row.folder,
  );
  if (conflict) {
    return conflict;
  }
  return {
    audience,
    folder,
    name: name.name,
    schemaJson: schema.schemaJson,
    webhookAuthorization: resolveSourceWebhookAuthUpdate(
      row,
      input,
      webhook.webhookUrl,
    ),
    webhookUrl: webhook.webhookUrl,
  };
}

async function loadEditableSharedSources(
  env: Env,
  user: SessionUser,
): Promise<ArticleSource[]> {
  const owners = await editableSharedOwnerIds(env, user);
  const sources: ArticleSource[] = [];
  for (const ownerId of owners) {
    sources.push(...(await sharedSourcesForOwner(env, user, ownerId)));
  }
  return sources;
}

export function createArticleService(env: Env) {
  return {
    async createSource(
      user: SessionUser,
      requestedOwnerId: string,
      input: ArticleSourceWrite,
    ): Promise<ArticleSource | SourceWriteError> {
      const prepared = await prepareNewSource(
        env,
        user,
        requestedOwnerId,
        input,
      );
      if ("error" in prepared) {
        return prepared;
      }
      const { audience, name, placed } = prepared;
      const existing = await db(env)
        .prepare(
          "SELECT id FROM article_sources WHERE owner_id = ? AND folder = ?",
        )
        .bind(placed.ownerId, placed.folder)
        .first<{ id: string }>();
      if (existing) {
        return { error: "このディレクトリは既に登録されています", status: 409 };
      }

      const now = Date.now();
      const id = crypto.randomUUID();
      await db(env)
        .prepare(
          `INSERT INTO article_sources (
             id, owner_id, folder, folder_id, name, schema_json,
             webhook_url, webhook_authorization, update_audience,
             last_dispatched_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .bind(
          id,
          placed.ownerId,
          placed.folder,
          placed.folderId,
          name,
          prepared.schemaJson,
          prepared.webhookUrl,
          prepared.webhookAuthorization,
          audience,
          now,
          now,
        )
        .run();

      const created = await loadSource(env, placed.ownerId, id);
      if (!created) {
        throw new Error("article source insert failed");
      }
      return presentForUser(created, user.id);
    },

    async deleteSource(user: SessionUser, id: string): Promise<boolean> {
      const row = await loadSourceById(env, id);
      if (!(row && (await canManageSource(env, user, row)))) {
        return false;
      }
      const result = await db(env)
        .prepare("DELETE FROM article_sources WHERE id = ?")
        .bind(id)
        .run();
      return result.meta.changes > 0;
    },

    async dispatch(
      user: SessionUser,
      id: string,
    ): Promise<{ ok: true } | { error: string; status: number } | null> {
      const row = await loadSourceById(env, id);
      if (!row) {
        return null;
      }
      const allowed = await userCanDispatchSource(env, user, row);
      if (!allowed) {
        return null;
      }
      if (!row.webhook_url) {
        return { error: "Webhook URL が設定されていません", status: 400 };
      }

      const headers: Record<string, string> = {
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      };
      if (row.webhook_authorization) {
        headers.Authorization = row.webhook_authorization;
      }

      let response: Response;
      try {
        response = await fetch(row.webhook_url, {
          body: JSON.stringify({
            client_payload: {
              collectionId: row.id,
              folder: row.folder,
            },
            event_type: "miyulabmd-publish",
          }),
          headers,
          method: "POST",
        });
      } catch {
        return { error: "Webhook の送信に失敗しました", status: 502 };
      }

      if (!response.ok) {
        return {
          error: `Webhook が ${response.status} を返しました`,
          status: 502,
        };
      }

      await db(env)
        .prepare(
          "UPDATE article_sources SET last_dispatched_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind(Date.now(), Date.now(), id)
        .run();
      return { ok: true };
    },

    async dispatchTarget(
      user: SessionUser,
      input: { folderId?: string; noteId?: string },
    ): Promise<{ id: string; name: string } | null> {
      if (input.noteId) {
        return dispatchTargetForNote(env, user, input.noteId);
      }
      if (!input.folderId) {
        return null;
      }
      const rec = await getFolderById(env, input.folderId);
      if (!rec?.folder) {
        return null;
      }
      return dispatchTargetForFolder(env, user, rec.owner_id, rec.folder);
    },

    async getEntry(
      ownerId: string,
      id: string,
      slug: string,
      origin: string,
    ): Promise<{ collection: ArticleCollection; entry: ArticleEntry } | null> {
      const row = await loadSource(env, ownerId, id);
      if (!row) {
        return null;
      }
      const schema = parseSchemaJson(row.schema_json);
      const note = await db(env)
        .prepare(
          `SELECT id, short_id, alias, title, folder, markdown_snapshot,
                  article_meta, created_at, updated_at
           FROM notes
           WHERE owner_id = ? AND (alias = ? OR short_id = ?)`,
        )
        .bind(ownerId, slug, slug)
        .first<NoteArticleRow>();
      if (!(note && folderMatchesSource(row.folder, note.folder))) {
        return null;
      }
      return {
        collection: presentCollection(row),
        entry: toEntry(note, schema, origin, true),
      };
    },

    async getSource(
      ownerId: string,
      id: string,
    ): Promise<ArticleSource | null> {
      const row = await loadSource(env, ownerId, id);
      return row ? presentSource(row) : null;
    },

    async listCollections(ownerId: string): Promise<ArticleCollection[]> {
      const rows = await db(env)
        .prepare(
          "SELECT * FROM article_sources WHERE owner_id = ? ORDER BY folder",
        )
        .bind(ownerId)
        .all<SourceRow>();
      return (rows.results ?? []).map(presentCollection);
    },
    listEditableSharedSources(user: SessionUser): Promise<ArticleSource[]> {
      return loadEditableSharedSources(env, user);
    },

    async listEntries(
      ownerId: string,
      id: string,
      origin: string,
      query: { page: number; perPage: number; folder: string | null },
    ): Promise<ArticleEntryPage | { error: string; status: number } | null> {
      const row = await loadSource(env, ownerId, id);
      if (!row) {
        return null;
      }
      const folder = resolveArticleListFolder(row.folder, query.folder);
      if (typeof folder !== "string") {
        return { error: folder.error, status: 400 };
      }
      const schema = parseSchemaJson(row.schema_json);
      const filter = sourceNoteFilter(folder);
      const countRow = await db(env)
        .prepare(
          `SELECT COUNT(*) AS total FROM notes
           WHERE owner_id = ? AND ${filter.sql}`,
        )
        .bind(ownerId, ...filter.binds)
        .first<{ total: number }>();
      const total = Number(countRow?.total ?? 0);
      const offset = (query.page - 1) * query.perPage;
      const notes = await db(env)
        .prepare(
          `SELECT id, short_id, alias, title, folder, markdown_snapshot,
                  article_meta, created_at, updated_at
           FROM notes
           WHERE owner_id = ? AND ${filter.sql}
           ORDER BY updated_at DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .bind(ownerId, ...filter.binds, query.perPage, offset)
        .all<NoteArticleRow>();
      return {
        collection: presentCollection(row),
        entries: (notes.results ?? []).map((note) =>
          toEntry(note, schema, origin, false),
        ),
        hasMore: offset + query.perPage < total,
        page: query.page,
        perPage: query.perPage,
        total,
      };
    },

    async listSources(ownerId: string): Promise<ArticleSource[]> {
      const rows = await db(env)
        .prepare(
          "SELECT * FROM article_sources WHERE owner_id = ? ORDER BY folder",
        )
        .bind(ownerId)
        .all<SourceRow>();
      return (rows.results ?? []).map((row) => presentSource(row));
    },

    async status(ownerId: string): Promise<ArticleSourceStatus> {
      const sources = await db(env)
        .prepare(
          "SELECT * FROM article_sources WHERE owner_id = ? ORDER BY folder",
        )
        .bind(ownerId)
        .all<SourceRow>();
      const items: ArticleSourceStatus["sources"] = [];
      for (const row of sources.results ?? []) {
        const maxUpdated = await maxNoteUpdatedAt(env, ownerId, row.folder);
        items.push({
          dirty: isArticleSourceDirty(row.last_dispatched_at, maxUpdated),
          id: row.id,
          name: row.name,
        });
      }
      return {
        dirty: items.some((item) => item.dirty),
        sources: items,
      };
    },

    async updateSource(
      user: SessionUser,
      id: string,
      input: ArticleSourceWrite,
    ): Promise<ArticleSource | SourceWriteError | null> {
      const row = await loadSourceById(env, id);
      if (!(row && (await canManageSource(env, user, row)))) {
        return null;
      }

      const prepared = await prepareSourceUpdate(env, user, row, input);
      if ("error" in prepared) {
        return prepared;
      }

      const now = Date.now();
      await db(env)
        .prepare(
          `UPDATE article_sources
           SET folder = ?, folder_id = ?, name = ?, schema_json = ?,
               webhook_url = ?, webhook_authorization = ?,
               update_audience = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(
          prepared.folder.folder,
          prepared.folder.folderId,
          prepared.name,
          prepared.schemaJson,
          prepared.webhookUrl,
          prepared.webhookAuthorization,
          prepared.audience,
          now,
          id,
        )
        .run();

      const updated = await loadSource(env, row.owner_id, id);
      return updated ? presentForUser(updated, user.id) : null;
    },
  };
}

export async function deleteArticleSourcesInFolder(
  env: Env,
  ownerId: string,
  folder: string,
): Promise<void> {
  const rows = await db(env)
    .prepare("SELECT id, folder FROM article_sources WHERE owner_id = ?")
    .bind(ownerId)
    .all<{ id: string; folder: string }>();
  for (const row of rows.results ?? []) {
    if (!folderMatchesSource(folder, row.folder)) {
      continue;
    }
    await db(env)
      .prepare("DELETE FROM article_sources WHERE id = ?")
      .bind(row.id)
      .run();
  }
}

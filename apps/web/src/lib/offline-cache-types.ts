import type {
  FolderAccess,
  FolderRecord,
  Note,
  NoteSummary,
} from "@miyulabmd/shared";
import type { AccountScope, SessionEpoch } from "./offline-types.ts";

/** Display-only permission flags — never use for authorization. Re-verify via GET/WS. */
export type CachedAccessFlags = {
  canView: boolean;
  canEdit: boolean;
  canAdmin: boolean;
};

export type CachedNoteAccess = {
  flags: CachedAccessFlags;
  inherit: boolean;
  readScope: Note["access"]["readScope"];
  writeScope: Note["access"]["writeScope"];
  effectiveReadScope: Note["access"]["effectiveReadScope"];
  effectiveWriteScope: Note["access"]["effectiveWriteScope"];
  source: Note["access"]["source"];
  sourceFolder: Note["access"]["sourceFolder"];
};

export type CachedNote = {
  scope: AccountScope;
  id: string;
  shortId: string;
  alias: string | null;
  ownerId: string;
  title: string;
  folder: string;
  folderId: string | null;
  permission: Note["permission"];
  access: CachedNoteAccess;
  markdown: string;
  articleMeta: Note["articleMeta"];
  createdAt: number;
  updatedAt: number;
  cachedAt: number;
  sessionEpoch: SessionEpoch;
};

export type CachedSummary = Omit<CachedNote, "markdown">;

export type CachedFolderRecord = FolderRecord;

export type CachedFolder = {
  scope: AccountScope;
  kind: "folder";
  key: string;
  id: string | null;
  name: string;
  parentId: string | null;
  folder?: string;
  crumbs: FolderAccess["crumbs"];
  children: CachedFolderRecord[];
  flags: CachedAccessFlags;
  inherit: boolean;
  readScope: FolderAccess["readScope"];
  writeScope: FolderAccess["writeScope"];
  effectiveReadScope: FolderAccess["effectiveReadScope"];
  effectiveWriteScope: FolderAccess["effectiveWriteScope"];
  source: FolderAccess["source"];
  sourceFolder: FolderAccess["sourceFolder"];
  locked?: boolean;
  cachedAt: number;
  sessionEpoch: SessionEpoch;
};

export type CachedNotesList = {
  scope: AccountScope;
  kind: "notes";
  key: "notes";
  summaries: CachedSummary[];
  cachedAt: number;
  sessionEpoch: SessionEpoch;
};

const EMPTY_GRANTS: Note["access"]["grants"] = [];

function cachedAccessToNoteAccess(access: CachedNoteAccess): Note["access"] {
  return { ...access, grants: EMPTY_GRANTS };
}

function noteAccessToCached(access: Note["access"]): CachedNoteAccess {
  return {
    effectiveReadScope: access.effectiveReadScope,
    effectiveWriteScope: access.effectiveWriteScope,
    flags: { ...access.flags },
    inherit: access.inherit,
    readScope: access.readScope,
    source: access.source,
    sourceFolder: access.sourceFolder,
    writeScope: access.writeScope,
  };
}

export function noteToCached(
  note: Note,
  scope: AccountScope,
  sessionEpoch: SessionEpoch,
  cachedAt = Date.now(),
): CachedNote {
  return {
    access: noteAccessToCached(note.access),
    alias: note.alias,
    articleMeta: note.articleMeta,
    cachedAt,
    createdAt: note.createdAt,
    folder: note.folder,
    folderId: note.folderId,
    id: note.id,
    markdown: note.markdown,
    ownerId: note.ownerId,
    permission: note.permission,
    scope,
    sessionEpoch,
    shortId: note.shortId,
    title: note.title,
    updatedAt: note.updatedAt,
  };
}

export function cachedToNote(cached: CachedNote): Note {
  return {
    access: cachedAccessToNoteAccess(cached.access),
    alias: cached.alias,
    articleMeta: cached.articleMeta,
    createdAt: cached.createdAt,
    folder: cached.folder,
    folderId: cached.folderId,
    id: cached.id,
    markdown: cached.markdown,
    ownerId: cached.ownerId,
    permission: cached.permission,
    shortId: cached.shortId,
    title: cached.title,
    updatedAt: cached.updatedAt,
  };
}

export function summaryToCached(
  summary: NoteSummary,
  scope: AccountScope,
  sessionEpoch: SessionEpoch,
  cachedAt = Date.now(),
): CachedSummary {
  const { access, ...rest } = summary;
  return {
    ...rest,
    access: noteAccessToCached(access),
    cachedAt,
    scope,
    sessionEpoch,
  };
}

export function cachedToSummary(cached: CachedSummary): NoteSummary {
  const {
    scope: _scope,
    cachedAt: _at,
    sessionEpoch: _epoch,
    access,
    ...rest
  } = cached;
  return {
    ...rest,
    access: cachedAccessToNoteAccess(access),
  };
}

export function folderToCached(
  folder: FolderAccess,
  scope: AccountScope,
  key: string,
  sessionEpoch: SessionEpoch,
  cachedAt = Date.now(),
): CachedFolder {
  return {
    cachedAt,
    children: folder.children.map((child) => ({ ...child })),
    crumbs: folder.crumbs.map((crumb) => ({ ...crumb })),
    effectiveReadScope: folder.effectiveReadScope,
    effectiveWriteScope: folder.effectiveWriteScope,
    flags: { ...folder.flags },
    folder: folder.folder,
    id: folder.id,
    inherit: folder.inherit,
    key,
    kind: "folder",
    locked: folder.locked,
    name: folder.name,
    parentId: folder.parentId,
    readScope: folder.readScope,
    scope,
    sessionEpoch,
    source: folder.source,
    sourceFolder: folder.sourceFolder,
    writeScope: folder.writeScope,
  };
}

export function cachedToFolder(cached: CachedFolder): FolderAccess {
  const {
    scope: _scope,
    kind: _kind,
    key: _key,
    cachedAt: _at,
    sessionEpoch: _epoch,
    ...rest
  } = cached;
  return { ...rest, grants: EMPTY_GRANTS };
}

export function summariesToListRecord(
  summaries: NoteSummary[],
  scope: AccountScope,
  sessionEpoch: SessionEpoch,
  cachedAt = Date.now(),
): CachedNotesList {
  return {
    cachedAt,
    key: "notes",
    kind: "notes",
    scope,
    sessionEpoch,
    summaries: summaries.map((summary) =>
      summaryToCached(summary, scope, sessionEpoch, cachedAt),
    ),
  };
}

export function listRecordToSummaries(record: CachedNotesList): NoteSummary[] {
  return record.summaries.map(cachedToSummary);
}

/** Strip grants / email from a persisted record if present (legacy or corrupt). */
export function sanitizeCachedNote(raw: unknown): CachedNote | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (
    typeof value.scope !== "string" ||
    typeof value.id !== "string" ||
    typeof value.shortId !== "string" ||
    typeof value.markdown !== "string"
  ) {
    return null;
  }
  const access = value.access as Record<string, unknown> | undefined;
  if (access && "grants" in access) {
    // biome-ignore lint/performance/noDelete: strip legacy sensitive fields from IDB
    delete access.grants;
  }
  return value as unknown as CachedNote;
}

export function sanitizeCachedSummary(raw: unknown): CachedSummary | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.scope !== "string" || typeof value.id !== "string") {
    return null;
  }
  const access = value.access as Record<string, unknown> | undefined;
  if (access && "grants" in access) {
    // biome-ignore lint/performance/noDelete: strip legacy sensitive fields from IDB
    delete access.grants;
  }
  return value as unknown as CachedSummary;
}

export function sanitizeCachedFolder(raw: unknown): CachedFolder | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.scope !== "string" || typeof value.key !== "string") {
    return null;
  }
  if ("grants" in value) {
    // biome-ignore lint/performance/noDelete: strip legacy sensitive fields from IDB
    delete value.grants;
  }
  return value as unknown as CachedFolder;
}

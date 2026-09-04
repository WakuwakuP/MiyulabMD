import { folderContains } from "./permission.ts";
import { normalizeFolder } from "./title.ts";

export const ARTICLE_FIELD_TYPES = [
  "string",
  "number",
  "boolean",
  "date",
  "string[]",
] as const;

export type ArticleFieldType = (typeof ARTICLE_FIELD_TYPES)[number];

export type ArticleSchemaField = {
  key: string;
  type: ArticleFieldType;
  required?: boolean;
  fixed?: boolean;
  default?: unknown;
  enum?: string[];
};

export type ArticleMeta = Record<string, unknown>;

export type ArticleSourceInput = {
  name: string;
  folder: string;
  schema: ArticleSchemaField[];
  webhookUrl?: string | null;
  webhookAuthorization?: string | null;
};

export type ArticleSource = {
  id: string;
  name: string;
  folder: string;
  folderId: string | null;
  schema: ArticleSchemaField[];
  webhookUrl: string | null;
  webhookAuthorizationSet: boolean;
  lastDispatchedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ArticleSourceStatus = {
  dirty: boolean;
  sources: Array<{ id: string; name: string; dirty: boolean }>;
};

export type ArticleCollection = {
  id: string;
  name: string;
  folder: string;
  schema: ArticleSchemaField[];
};

export type ArticleEntry = {
  id: string;
  slug: string;
  title: string;
  folder: string;
  createdAt: number;
  updatedAt: number;
  data: ArticleMeta;
  editUrl: string;
  markdown?: string;
};

export const ARTICLE_LIST_DEFAULT_PER_PAGE = 50;
export const ARTICLE_LIST_MAX_PER_PAGE = 100;

export type ArticleEntryPage = {
  collection: ArticleCollection;
  entries: ArticleEntry[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
};

export function parseArticleListQuery(
  searchParams: URLSearchParams,
):
  | { page: number; perPage: number; folder: string | null }
  | { error: string } {
  const pageRaw = searchParams.get("page");
  const perPageRaw = searchParams.get("perPage");
  const folderRaw = searchParams.get("folder");

  let page = 1;
  if (pageRaw != null && pageRaw !== "") {
    const value = Number(pageRaw);
    if (!Number.isInteger(value) || value < 1) {
      return { error: "page が不正です" };
    }
    page = value;
  }

  let perPage = ARTICLE_LIST_DEFAULT_PER_PAGE;
  if (perPageRaw != null && perPageRaw !== "") {
    const value = Number(perPageRaw);
    if (!Number.isInteger(value) || value < 1) {
      return { error: "perPage が不正です" };
    }
    perPage = Math.min(value, ARTICLE_LIST_MAX_PER_PAGE);
  }

  const folder =
    folderRaw == null || folderRaw === "" ? null : normalizeFolder(folderRaw);
  if (folderRaw && !folder) {
    return { error: "folder が不正です" };
  }

  return { page, perPage, folder };
}

/** 一覧の絞り込み先。未指定ならソース直下、指定ならその配下（ソースの子孫に限る）。 */
export function resolveArticleListFolder(
  sourceFolder: string,
  requested: string | null | undefined,
): string | { error: string } {
  if (!requested) return sourceFolder;
  const folder = normalizeFolder(requested);
  if (!folder) return { error: "folder が不正です" };
  if (!folderContains(sourceFolder, folder)) {
    return { error: "folder はこのコレクション配下である必要があります" };
  }
  return folder;
}

const FIELD_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isArticleFieldType(value: string): value is ArticleFieldType {
  return (ARTICLE_FIELD_TYPES as readonly string[]).includes(value);
}

export function parseArticleSchema(
  value: unknown,
): ArticleSchemaField[] | { error: string } {
  if (!Array.isArray(value)) {
    return { error: "schema は配列である必要があります" };
  }

  const fields: ArticleSchemaField[] = [];
  const seen = new Set<string>();

  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { error: `schema[${index}] が不正です` };
    }
    const raw = item as Record<string, unknown>;
    const key = typeof raw.key === "string" ? raw.key.trim() : "";
    if (!FIELD_KEY.test(key)) {
      return { error: `schema[${index}].key が不正です` };
    }
    if (seen.has(key)) {
      return { error: `schema の key が重複しています: ${key}` };
    }
    if (typeof raw.type !== "string" || !isArticleFieldType(raw.type)) {
      return { error: `schema[${index}].type が不正です` };
    }

    const field: ArticleSchemaField = { key, type: raw.type };
    if (raw.required === true) field.required = true;
    if (raw.fixed === true) field.fixed = true;
    if (Array.isArray(raw.enum)) {
      if (raw.type !== "string") {
        return { error: `schema[${index}].enum は string のみ使えます` };
      }
      if (!raw.enum.every((entry) => typeof entry === "string")) {
        return { error: `schema[${index}].enum が不正です` };
      }
      field.enum = raw.enum;
    }
    if (raw.default !== undefined) {
      const coerced = coerceArticleValue(raw.type, raw.default, field.enum);
      if (coerced === undefined) {
        return { error: `schema[${index}].default が型と一致しません` };
      }
      field.default = coerced;
    }
    seen.add(key);
    fields.push(field);
  }

  return fields;
}

export function parseArticleMeta(value: unknown): ArticleMeta {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parseArticleMeta(parsed);
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return { ...(value as ArticleMeta) };
  }
  return {};
}

export function coerceArticleValue(
  type: ArticleFieldType,
  value: unknown,
  enums?: string[],
): unknown {
  if (value === undefined || value === null) return undefined;

  switch (type) {
    case "string": {
      if (typeof value !== "string") return undefined;
      if (enums && !enums.includes(value)) return undefined;
      return value;
    }
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
    case "boolean":
      return typeof value === "boolean" ? value : undefined;
    case "date":
      if (typeof value !== "string" || !value.trim()) return undefined;
      return Number.isNaN(Date.parse(value)) ? undefined : value;
    case "string[]":
      return Array.isArray(value) &&
        value.every((item) => typeof item === "string")
        ? value
        : undefined;
    default:
      return undefined;
  }
}

/** fixed 値 → ノート値 → default。title が無ければ見出しを使う。 */
export function mergeArticleData(input: {
  schema: ArticleSchemaField[];
  noteMeta: ArticleMeta | null | undefined;
  title: string;
}): ArticleMeta {
  const data: ArticleMeta = {};
  const noteMeta = input.noteMeta ?? {};

  for (const field of input.schema) {
    if (field.fixed) {
      if (field.default !== undefined) data[field.key] = field.default;
      continue;
    }
    const fromNote = coerceArticleValue(
      field.type,
      noteMeta[field.key],
      field.enum,
    );
    if (fromNote !== undefined) {
      data[field.key] = fromNote;
      continue;
    }
    if (field.default !== undefined) data[field.key] = field.default;
  }

  if (typeof data.title !== "string" || !data.title.trim()) {
    data.title = input.title;
  }

  return data;
}

export function matchArticleSource<T extends { folder: string }>(
  folder: string,
  sources: T[],
): T | null {
  let best: T | null = null;
  for (const source of sources) {
    if (!folderContains(source.folder, folder)) continue;
    if (!best || source.folder.length > best.folder.length) {
      best = source;
    }
  }
  return best;
}

export function isArticleSourceDirty(
  lastDispatchedAt: number | null,
  maxNoteUpdatedAt: number | null,
): boolean {
  if (maxNoteUpdatedAt === null) return false;
  if (lastDispatchedAt === null) return true;
  return maxNoteUpdatedAt > lastDispatchedAt;
}

export function articleSlug(
  alias: string | null | undefined,
  shortId: string,
): string {
  const trimmed = alias?.trim();
  return trimmed || shortId;
}

export function articleEditUrl(origin: string, shortId: string): string {
  return `${origin.replace(/\/$/, "")}/n/${shortId}`;
}

export function folderMatchesSource(
  sourceFolder: string,
  folder: string,
): boolean {
  return folderContains(sourceFolder, folder);
}

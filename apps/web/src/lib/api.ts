import type { TaskCheckboxUpdate } from "@miyulabmd/markdown";
import type {
  AccessGrantInput,
  AccessScope,
  ArticleSource,
  ArticleSourceStatus,
  CreateNoteInput,
  FolderAccess,
  FolderRecord,
  Note,
  NoteHistoryPage,
  NoteRevisionBody,
  NoteRevisionRestore,
  NoteSummary,
  PermissionPreset,
  SessionUser,
} from "@miyulabmd/shared";
import { notifyArticleChanged } from "./article-changed.ts";
import type { OgPreview } from "./embeds.ts";

const fetchOpts: RequestInit = { credentials: "include" };

/** Custom-domain Worker cannot fetch same-zone CNAMEs; workers.dev can. */
const OG_FALLBACK_ORIGIN = "https://miyulabmd.wakuwakup.workers.dev";

function ogFallbackOrigin(): string | null {
  if (
    typeof window !== "undefined" &&
    window.location.origin === OG_FALLBACK_ORIGIN
  ) {
    return null;
  }
  return OG_FALLBACK_ORIGIN;
}

export type ApiFailure =
  | { ok: false; kind: "network"; status: 0; error: string }
  | { ok: false; kind: "aborted"; status: 0; error: string }
  | { ok: false; kind: "http"; status: number; error: string }
  | {
      ok: false;
      kind: "invalid-response";
      status: number;
      error: string;
    };

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

export type ApiResponseFormat<T> =
  | { kind: "json"; parse: (body: unknown) => T | null }
  | { kind: "empty" };

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function parseErrorFromText(text: string, statusText: string): string {
  try {
    const body = JSON.parse(text) as { error?: string };
    return body.error ?? statusText;
  } catch {
    return statusText;
  }
}

function looksLikeHtml(text: string): boolean {
  const trimmed = text.trimStart().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: single REST transport entry
export async function apiRequest<T>(
  url: string,
  // biome-ignore lint/style/useDefaultParameterLast: optional init before format keeps call sites readable
  init: RequestInit = {},
  format: ApiResponseFormat<T>,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (error) {
    if (isAbortError(error)) {
      return {
        error: "Request aborted",
        kind: "aborted",
        ok: false,
        status: 0,
      };
    }
    return {
      error: error instanceof Error ? error.message : "Network error",
      kind: "network",
      ok: false,
      status: 0,
    };
  }

  if (format.kind === "empty") {
    if (!res.ok) {
      let text = "";
      try {
        text = await res.text();
      } catch (error) {
        if (isAbortError(error)) {
          return {
            error: "Request aborted",
            kind: "aborted",
            ok: false,
            status: 0,
          };
        }
        return {
          error: "Failed to read response",
          kind: "network",
          ok: false,
          status: 0,
        };
      }
      return {
        error: parseErrorFromText(text, res.statusText),
        kind: "http",
        ok: false,
        status: res.status,
      };
    }
    return { data: undefined as T, ok: true };
  }

  let text: string;
  try {
    text = await res.text();
  } catch (error) {
    if (isAbortError(error)) {
      return {
        error: "Request aborted",
        kind: "aborted",
        ok: false,
        status: 0,
      };
    }
    return {
      error: "Failed to read response",
      kind: "network",
      ok: false,
      status: 0,
    };
  }

  if (!res.ok) {
    return {
      error: parseErrorFromText(text, res.statusText),
      kind: "http",
      ok: false,
      status: res.status,
    };
  }

  if (!text.trim()) {
    return {
      error: "Empty response body",
      kind: "invalid-response",
      ok: false,
      status: res.status,
    };
  }

  if (looksLikeHtml(text)) {
    return {
      error: "Non-JSON response",
      kind: "invalid-response",
      ok: false,
      status: res.status,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      error: "Invalid JSON",
      kind: "invalid-response",
      ok: false,
      status: res.status,
    };
  }

  const data = format.parse(parsed);
  if (data === null) {
    return {
      error: "Invalid response schema",
      kind: "invalid-response",
      ok: false,
      status: res.status,
    };
  }

  return { data, ok: true };
}

export type AuthConfig = {
  access: boolean;
  mock: boolean;
};

function parseAuthConfig(body: unknown): AuthConfig | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "access" in body &&
    typeof (body as AuthConfig).access === "boolean" &&
    "mock" in body &&
    typeof (body as AuthConfig).mock === "boolean"
  ) {
    return body as AuthConfig;
  }
  return null;
}

export async function fetchAuthConfig(): Promise<ApiResult<AuthConfig>> {
  return await apiRequest("/api/auth/config", fetchOpts, {
    kind: "json",
    parse: parseAuthConfig,
  });
}

function parseMeBody(body: unknown): { user: SessionUser | null } | null {
  if (typeof body === "object" && body !== null && "user" in body) {
    return body as { user: SessionUser | null };
  }
  return null;
}

export async function fetchMe(): Promise<
  ApiResult<{ user: SessionUser | null }>
> {
  return await apiRequest("/api/me", fetchOpts, {
    kind: "json",
    parse: parseMeBody,
  });
}

function parseNotesBody(body: unknown): NoteSummary[] | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "notes" in body &&
    Array.isArray((body as { notes: unknown }).notes)
  ) {
    return (body as { notes: NoteSummary[] }).notes;
  }
  return null;
}

export async function fetchNotes(): Promise<ApiResult<NoteSummary[]>> {
  return await apiRequest("/api/notes", fetchOpts, {
    kind: "json",
    parse: parseNotesBody,
  });
}

export async function fetchNote(id: string): Promise<ApiResult<Note>> {
  return await apiRequest(`/api/notes/${id}`, fetchOpts, {
    kind: "json",
    parse: (body) =>
      typeof body === "object" && body !== null ? (body as Note) : null,
  });
}

export async function updateTaskCheckbox(
  id: string,
  input: TaskCheckboxUpdate,
): Promise<ApiResult<{ ok: true; checked: boolean }>> {
  return await apiRequest(
    `/api/notes/${id}/task-checkbox`,
    {
      ...fetchOpts,
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    },
    {
      kind: "json",
      parse: (body) =>
        typeof body === "object" && body !== null
          ? (body as { ok: true; checked: boolean })
          : null,
    },
  );
}

export async function fetchNoteHistory(
  id: string,
  query: { limit?: number; before?: number } = {},
): Promise<ApiResult<NoteHistoryPage>> {
  const params = new URLSearchParams();
  if (query.limit !== undefined) {
    params.set("limit", String(query.limit));
  }
  if (query.before !== undefined) {
    params.set("before", String(query.before));
  }
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return await apiRequest(`/api/notes/${id}/history${suffix}`, fetchOpts, {
    kind: "json",
    parse: (body) =>
      typeof body === "object" && body !== null
        ? (body as NoteHistoryPage)
        : null,
  });
}

export async function fetchNoteRevision(
  id: string,
  revisionId: string,
): Promise<ApiResult<NoteRevisionBody>> {
  return await apiRequest(
    `/api/notes/${id}/revisions/${revisionId}`,
    fetchOpts,
    {
      kind: "json",
      parse: (body) =>
        typeof body === "object" && body !== null
          ? (body as NoteRevisionBody)
          : null,
    },
  );
}

export async function restoreNoteRevision(
  id: string,
  revisionId: string,
): Promise<ApiResult<NoteRevisionRestore>> {
  return await apiRequest(
    `/api/notes/${id}/revisions/${revisionId}/restore`,
    { ...fetchOpts, method: "POST" },
    {
      kind: "json",
      parse: (body) =>
        typeof body === "object" && body !== null
          ? (body as NoteRevisionRestore)
          : null,
    },
  );
}

export async function createNote(
  input: CreateNoteInput = {},
): Promise<ApiResult<Note>> {
  const result = await apiRequest<Note>(
    "/api/notes",
    {
      ...fetchOpts,
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    {
      kind: "json",
      parse: (body) =>
        typeof body === "object" && body !== null ? (body as Note) : null,
    },
  );
  if (result.ok) {
    notifyArticleChanged();
  }
  return result;
}

function parseSessionUserBody(body: unknown): SessionUser | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "user" in body &&
    typeof (body as { user: unknown }).user === "object" &&
    (body as { user: SessionUser | null }).user !== null
  ) {
    return (body as { user: SessionUser }).user;
  }
  return null;
}

export async function updateProfile(
  displayName: string | null,
): Promise<ApiResult<SessionUser>> {
  return await apiRequest(
    "/api/me",
    {
      ...fetchOpts,
      body: JSON.stringify({ displayName }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    },
    {
      kind: "json",
      parse: parseSessionUserBody,
    },
  );
}

export async function updateNote(
  id: string,
  patch: {
    title?: string;
    markdown?: string;
    folder?: string;
    permission?: PermissionPreset;
    inheritAccess?: boolean;
    readScope?: AccessScope | null;
    writeScope?: AccessScope | null;
    grants?: AccessGrantInput[];
  },
): Promise<ApiResult<Note>> {
  const result = await apiRequest<Note>(
    `/api/notes/${id}`,
    {
      ...fetchOpts,
      body: JSON.stringify(patch),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    },
    {
      kind: "json",
      parse: (body) =>
        typeof body === "object" && body !== null ? (body as Note) : null,
    },
  );
  if (result.ok) {
    notifyArticleChanged();
  }
  return result;
}

function parseFoldersBody(body: unknown): FolderRecord[] | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "folders" in body &&
    Array.isArray((body as { folders: unknown }).folders)
  ) {
    return (body as { folders: FolderRecord[] }).folders;
  }
  return null;
}

export async function fetchFolderTree(): Promise<ApiResult<FolderRecord[]>> {
  return await apiRequest("/api/folders/tree", fetchOpts, {
    kind: "json",
    parse: parseFoldersBody,
  });
}

export async function fetchPublicFolders(): Promise<ApiResult<FolderRecord[]>> {
  return await apiRequest("/api/folders/public", fetchOpts, {
    kind: "json",
    parse: parseFoldersBody,
  });
}

export async function fetchSharedFolders(): Promise<ApiResult<FolderRecord[]>> {
  return await apiRequest("/api/folders/shared", fetchOpts, {
    kind: "json",
    parse: parseFoldersBody,
  });
}

export async function createFolder(input: {
  name: string;
  parentId?: string | null;
}): Promise<ApiResult<FolderAccess>> {
  return await apiRequest(
    "/api/folders",
    {
      ...fetchOpts,
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    {
      kind: "json",
      parse: (body) =>
        typeof body === "object" && body !== null
          ? (body as FolderAccess)
          : null,
    },
  );
}

export async function fetchFolder(
  id?: string | null,
): Promise<ApiResult<FolderAccess>> {
  return await apiRequest(
    id ? `/api/folders/${id}` : "/api/folders",
    fetchOpts,
    {
      kind: "json",
      parse: (body) =>
        typeof body === "object" && body !== null
          ? (body as FolderAccess)
          : null,
    },
  );
}

export async function renameFolder(
  id: string,
  name: string,
): Promise<ApiResult<FolderAccess>> {
  return await apiRequest(
    `/api/folders/${id}`,
    {
      ...fetchOpts,
      body: JSON.stringify({ name }),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    },
    {
      kind: "json",
      parse: (body) =>
        typeof body === "object" && body !== null
          ? (body as FolderAccess)
          : null,
    },
  );
}

export async function updateFolderAccess(input: {
  folderId: string;
  inherit?: boolean;
  readScope?: AccessScope;
  writeScope?: AccessScope;
  grants?: AccessGrantInput[];
}): Promise<ApiResult<FolderAccess>> {
  return await apiRequest(
    "/api/folders",
    {
      ...fetchOpts,
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    },
    {
      kind: "json",
      parse: (body) =>
        typeof body === "object" && body !== null
          ? (body as FolderAccess)
          : null,
    },
  );
}

const ogPreviewCache = new Map<string, OgPreview>();
const ogPreviewInflight = new Map<string, Promise<ApiResult<OgPreview>>>();

function parseOgPreview(body: unknown): OgPreview | null {
  if (typeof body === "object" && body !== null && "url" in body) {
    return body as OgPreview;
  }
  return null;
}

async function requestOgPreview(path: string, init: RequestInit) {
  return await apiRequest<OgPreview>(path, init, {
    kind: "json",
    parse: parseOgPreview,
  });
}

export function peekOgPreview(url: string): OgPreview | undefined {
  return ogPreviewCache.get(url);
}

export function seedOgPreviews(
  cards: Record<string, OgPreview> | Map<string, OgPreview>,
): void {
  const entries =
    cards instanceof Map ? cards.entries() : Object.entries(cards);
  for (const [url, card] of entries) {
    if (!card) {
      continue;
    }
    ogPreviewCache.set(url, card);
    if (card.url) {
      ogPreviewCache.set(card.url, card);
    }
  }
}

export async function fetchOgPreview(
  url: string,
): Promise<ApiResult<OgPreview>> {
  const cached = ogPreviewCache.get(url);
  if (cached) {
    return { data: cached, ok: true };
  }
  const inflight = ogPreviewInflight.get(url);
  if (inflight) {
    return inflight;
  }

  const pending = (async () => {
    const path = `/api/og?url=${encodeURIComponent(url)}`;
    let result = await requestOgPreview(path, fetchOpts);
    const fallbackOrigin = ogFallbackOrigin();
    if (!result.ok && fallbackOrigin) {
      result = await requestOgPreview(`${fallbackOrigin}${path}`, {
        credentials: "omit",
      });
    }
    if (result.ok) {
      ogPreviewCache.set(url, result.data);
    }
    return result;
  })().finally(() => {
    ogPreviewInflight.delete(url);
  });

  ogPreviewInflight.set(url, pending);
  return await pending;
}

export async function uploadImage(
  noteId: string,
  file: File,
): Promise<ApiResult<{ id: string; url: string }>> {
  const form = new FormData();
  form.append("file", file);
  return await apiRequest(
    `/api/notes/${noteId}/images`,
    {
      ...fetchOpts,
      body: form,
      method: "POST",
    },
    {
      kind: "json",
      parse: (body) => {
        if (
          typeof body === "object" &&
          body !== null &&
          "id" in body &&
          "url" in body
        ) {
          return body as { id: string; url: string };
        }
        return null;
      },
    },
  );
}

export type FolderDeletePayload = {
  deletedFolderIds: string[];
  deletedNoteIds: string[];
};

export async function deleteFolder(
  id: string,
): Promise<ApiResult<FolderDeletePayload>> {
  return await apiRequest(
    `/api/folders/${id}`,
    {
      ...fetchOpts,
      method: "DELETE",
    },
    {
      kind: "json",
      parse: (body) => {
        if (
          typeof body === "object" &&
          body !== null &&
          "deletedNoteIds" in body &&
          "deletedFolderIds" in body &&
          Array.isArray(body.deletedNoteIds) &&
          Array.isArray(body.deletedFolderIds) &&
          body.deletedNoteIds.every((item) => typeof item === "string") &&
          body.deletedFolderIds.every((item) => typeof item === "string")
        ) {
          return body as FolderDeletePayload;
        }
        return null;
      },
    },
  );
}

export async function deleteNote(id: string): Promise<ApiResult<void>> {
  return await apiRequest(
    `/api/notes/${id}`,
    {
      ...fetchOpts,
      method: "DELETE",
    },
    { kind: "empty" },
  );
}

export async function logout(): Promise<void> {
  // Best-effort cookie clear; full teardown is offline-session coordinator (#93).
  await apiRequest(
    "/auth/logout",
    { ...fetchOpts, method: "POST" },
    {
      kind: "empty",
    },
  );
}

export type ApiTokenSummary = {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
};

export type ApiTokenCreated = ApiTokenSummary & {
  token: string;
};

function parseTokensBody(body: unknown): ApiTokenSummary[] | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "tokens" in body &&
    Array.isArray((body as { tokens: unknown }).tokens)
  ) {
    return (body as { tokens: ApiTokenSummary[] }).tokens;
  }
  return null;
}

export async function fetchTokens(): Promise<ApiResult<ApiTokenSummary[]>> {
  return await apiRequest("/api/tokens", fetchOpts, {
    kind: "json",
    parse: parseTokensBody,
  });
}

export async function createToken(
  name: string,
): Promise<ApiResult<ApiTokenCreated>> {
  return await apiRequest(
    "/api/tokens",
    {
      ...fetchOpts,
      body: JSON.stringify({ name }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    {
      kind: "json",
      parse: (body) =>
        typeof body === "object" && body !== null
          ? (body as ApiTokenCreated)
          : null,
    },
  );
}

export type ArticleSourceWrite = {
  name?: string;
  folder?: string;
  folderId?: string | null;
  schema?: ArticleSource["schema"];
  webhookUrl?: string | null;
  webhookAuthorization?: string | null;
};

function parseArticleSourcesBody(body: unknown): ArticleSource[] | null {
  if (
    typeof body === "object" &&
    body !== null &&
    "sources" in body &&
    Array.isArray((body as { sources: unknown }).sources)
  ) {
    return (body as { sources: ArticleSource[] }).sources;
  }
  return null;
}

export async function fetchArticleSources(): Promise<
  ApiResult<ArticleSource[]>
> {
  return await apiRequest("/api/article-sources", fetchOpts, {
    kind: "json",
    parse: parseArticleSourcesBody,
  });
}

export async function fetchArticleSourceStatus(): Promise<
  ApiResult<ArticleSourceStatus>
> {
  return await apiRequest("/api/article-sources/status", fetchOpts, {
    kind: "json",
    parse: (body) =>
      typeof body === "object" && body !== null
        ? (body as ArticleSourceStatus)
        : null,
  });
}

export async function createArticleSource(
  input: ArticleSourceWrite,
): Promise<ApiResult<ArticleSource>> {
  const result = await apiRequest<ArticleSource>(
    "/api/article-sources",
    {
      ...fetchOpts,
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    {
      kind: "json",
      parse: (body) =>
        typeof body === "object" && body !== null
          ? (body as ArticleSource)
          : null,
    },
  );
  if (result.ok) {
    notifyArticleChanged();
  }
  return result;
}

export async function updateArticleSource(
  id: string,
  input: ArticleSourceWrite,
): Promise<ApiResult<ArticleSource>> {
  const result = await apiRequest<ArticleSource>(
    `/api/article-sources/${id}`,
    {
      ...fetchOpts,
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
    },
    {
      kind: "json",
      parse: (body) =>
        typeof body === "object" && body !== null
          ? (body as ArticleSource)
          : null,
    },
  );
  if (result.ok) {
    notifyArticleChanged();
  }
  return result;
}

export async function deleteArticleSource(
  id: string,
): Promise<ApiResult<void>> {
  const result = await apiRequest<void>(
    `/api/article-sources/${id}`,
    { ...fetchOpts, method: "DELETE" },
    { kind: "empty" },
  );
  if (result.ok) {
    notifyArticleChanged();
  }
  return result;
}

export async function dispatchArticleSource(
  id: string,
): Promise<ApiResult<void>> {
  return await apiRequest(
    `/api/article-sources/${id}/dispatch`,
    { ...fetchOpts, method: "POST" },
    { kind: "empty" },
  );
}

export async function revokeToken(id: string): Promise<ApiResult<void>> {
  return await apiRequest(
    `/api/tokens/${id}`,
    {
      ...fetchOpts,
      method: "DELETE",
    },
    { kind: "empty" },
  );
}

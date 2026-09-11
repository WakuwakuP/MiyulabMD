import type { Note } from "@miyulabmd/shared";
import { titleFromMarkdown } from "@miyulabmd/shared";
import type { ApiFailure, ApiResult } from "../lib/api.ts";
import { loadOgCards } from "../lib/markdown.ts";
import { readNoteBootstrap } from "../lib/note-bootstrap.ts";
import {
  getLoadedNoteMeta,
  loadNoteRecord,
  noteFromCaches,
  seedNoteCache,
} from "../lib/note-cache.ts";
import { getHydratableScope } from "../lib/offline-scope.ts";
import { evictNotesEverywhere } from "../lib/offline-session.ts";

export type ShareDenied = 401 | 403;

export type ShareViewPhase =
  | "loading"
  | "cached-preview"
  | "revalidating"
  | "offline-preview"
  | "server-preview"
  | "uncached"
  | "denied"
  | "not-found"
  | "load-error";

export type ShareLoadSetters = {
  setMarkdown: (markdown: string) => void;
  setLoading: (loading: boolean) => void;
  setDenied: (denied: ShareDenied | null) => void;
  setError: (error: string | null) => void;
  setPreviewBanner: (banner: string | null) => void;
  setPhase: (phase: ShareViewPhase) => void;
};

export type ShareNoteSnapshot = {
  markdown: string;
  denied: ShareDenied | null;
  error: string | null;
  previewBanner: string | null;
  phase: ShareViewPhase;
};

function readAllowedSharePreview(id: string): Note | null {
  const boot = readNoteBootstrap(id);
  if (boot) {
    seedNoteCache(boot);
    return boot;
  }
  if (!getHydratableScope()) {
    return null;
  }
  return noteFromCaches(id) ?? null;
}

export function beginShareNoteLoad(id: string, setters: ShareLoadSetters) {
  setters.setDenied(null);
  setters.setError(null);
  setters.setPreviewBanner(null);
  const hit = readAllowedSharePreview(id);
  if (hit) {
    setters.setMarkdown(hit.markdown);
    document.title = `${titleFromMarkdown(hit.markdown)} · MiyulabMD`;
    setters.setPhase("cached-preview");
    setters.setLoading(false);
    void loadOgCards(hit.markdown);
    return hit;
  }
  setters.setPhase("loading");
  setters.setLoading(true);
}

function isServerOutage(result: ApiFailure): boolean {
  return result.kind === "http" && result.status >= 500;
}

function serverFailureRequiresEviction(result: ApiFailure): boolean {
  return (
    result.kind === "http" && (result.status === 403 || result.status === 404)
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: share force GET error table
export function applyShareForceLoadResult(input: {
  result: ApiResult<{
    note: Note;
    cachedAt: number;
    verifiedForSession: boolean;
  }>;
  hadPreview: boolean;
  routeId: string;
}): ShareNoteSnapshot & { evictIds?: string[]; stale: boolean } {
  const { result, hadPreview, routeId } = input;

  if (result.ok) {
    void loadOgCards(result.data.note.markdown);
    document.title = `${titleFromMarkdown(result.data.note.markdown)} · MiyulabMD`;
    return {
      denied: null,
      error: null,
      markdown: result.data.note.markdown,
      phase: "server-preview",
      previewBanner: null,
      stale: false,
    };
  }

  if (result.kind === "aborted") {
    return {
      denied: null,
      error: null,
      markdown: "",
      phase: "loading",
      previewBanner: null,
      stale: true,
    };
  }

  if (result.kind === "network") {
    if (hadPreview) {
      return {
        denied: null,
        error: null,
        markdown: "",
        phase: "offline-preview",
        previewBanner: "オフライン: 端末に保存された内容を表示しています",
        stale: false,
      };
    }
    return {
      denied: null,
      error: "まだキャッシュされていません。オンラインで一度開いてください。",
      markdown: "",
      phase: "uncached",
      previewBanner: null,
      stale: false,
    };
  }

  if (isServerOutage(result)) {
    if (hadPreview) {
      return {
        denied: null,
        error: null,
        markdown: "",
        phase: "offline-preview",
        previewBanner:
          "オフライン: 端末に保存された内容を表示しています（サーバー障害のため read-only）",
        stale: false,
      };
    }
    return {
      denied: null,
      error: result.error,
      markdown: "",
      phase: "load-error",
      previewBanner: null,
      stale: false,
    };
  }

  if (result.kind === "http" && result.status === 401) {
    return {
      denied: 401,
      error: null,
      markdown: "",
      phase: "denied",
      previewBanner: null,
      stale: false,
    };
  }

  if (serverFailureRequiresEviction(result)) {
    const phase: ShareViewPhase =
      result.status === 404 ? "not-found" : "denied";
    return {
      denied: result.status === 403 ? 403 : null,
      error:
        result.status === 404
          ? "ノートが見つかりません。"
          : "このノートを表示する権限がありません。",
      evictIds: [routeId],
      markdown: "",
      phase,
      previewBanner: null,
      stale: false,
    };
  }

  if (result.kind === "invalid-response") {
    return {
      denied: null,
      error: result.error,
      markdown: hadPreview ? "" : "",
      phase: "load-error",
      previewBanner: null,
      stale: false,
    };
  }

  return {
    denied: null,
    error: result.error,
    markdown: "",
    phase: "load-error",
    previewBanner: null,
    stale: false,
  };
}

export function applyShareNoteLoad(
  result: ApiResult<Note>,
  hit: Note | undefined,
  cancelled: boolean,
  setters: ShareLoadSetters,
) {
  if (cancelled) {
    return;
  }
  if (!result.ok) {
    applyShareForceLoadResult({
      hadPreview: Boolean(hit),
      result,
      routeId: "",
    });
    setters.setLoading(false);
    return;
  }

  setters.setMarkdown(result.data.markdown);
  document.title = `${titleFromMarkdown(result.data.markdown)} · MiyulabMD`;
  setters.setPhase("server-preview");
  setters.setLoading(false);
  void loadOgCards(result.data.markdown);
}

export function mergeShareLoadOutcome(
  current: ShareNoteSnapshot,
  outcome: ReturnType<typeof applyShareForceLoadResult>,
): ShareNoteSnapshot {
  if (outcome.stale) {
    return current;
  }
  if (outcome.evictIds?.length) {
    evictNotesEverywhere(outcome.evictIds, "share-load-denied");
  }
  return {
    denied: outcome.denied ?? current.denied,
    error: outcome.error ?? current.error,
    markdown: outcome.markdown || current.markdown,
    phase: outcome.phase,
    previewBanner: outcome.previewBanner ?? current.previewBanner,
  };
}

export function shouldRemoveShareSsrPreview(phase: ShareViewPhase): boolean {
  return phase !== "loading";
}

export function subscribeShareNote(id: string, setters: ShareLoadSetters) {
  const hit = beginShareNoteLoad(id, setters);
  let cancelled = false;
  setters.setPhase(hit ? "revalidating" : "loading");
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: applies share load outcome
  void loadNoteRecord(id, true).then((result) => {
    if (cancelled) {
      return;
    }
    const normalized = result.ok
      ? {
          data: {
            cachedAt: result.data.cachedAt,
            note: result.data.note,
            verifiedForSession: result.data.verifiedForSession,
          },
          ok: true as const,
        }
      : result;
    const outcome = applyShareForceLoadResult({
      hadPreview: Boolean(hit),
      result: normalized,
      routeId: id,
    });
    if (outcome.stale) {
      setters.setLoading(false);
      return;
    }
    if (outcome.evictIds?.length) {
      evictNotesEverywhere(outcome.evictIds, "share-load-denied");
    }
    if (outcome.denied) {
      setters.setDenied(outcome.denied);
      setters.setMarkdown("");
      setters.setError(null);
    } else if (outcome.error && !hit) {
      setters.setError(outcome.error);
      setters.setMarkdown("");
    } else if (outcome.markdown) {
      setters.setMarkdown(outcome.markdown);
    }
    setters.setPreviewBanner(outcome.previewBanner);
    setters.setPhase(outcome.phase);
    setters.setLoading(false);
    if (result.ok) {
      void loadOgCards(result.data.note.markdown);
    }
  });
  return () => {
    cancelled = true;
  };
}

export function sharePreviewMeta(
  id: string,
): ReturnType<typeof getLoadedNoteMeta> {
  return getLoadedNoteMeta(id);
}

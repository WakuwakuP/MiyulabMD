import type { Note } from "@miyulabmd/shared";
import { titleFromMarkdown } from "@miyulabmd/shared";
import type { ApiResult } from "../lib/api.ts";
import { loadOgCards } from "../lib/markdown.ts";
import { loadNote, noteFromCaches } from "../lib/note-cache.ts";

export type ShareDenied = 401 | 403;

export type ShareLoadSetters = {
  setMarkdown: (markdown: string) => void;
  setLoading: (loading: boolean) => void;
  setDenied: (denied: ShareDenied | null) => void;
  setError: (error: string | null) => void;
};

function applyShareFailure(
  result: Extract<ApiResult<Note>, { ok: false }>,
  setters: ShareLoadSetters,
) {
  if (result.status === 401) {
    setters.setDenied(401);
    return;
  }
  if (result.status === 403) {
    setters.setDenied(403);
    return;
  }
  if (result.status === 404) {
    setters.setError("ノートが見つかりません。");
    return;
  }
  setters.setError(result.error);
}

export function beginShareNoteLoad(id: string, setters: ShareLoadSetters) {
  const hit = noteFromCaches(id);
  setters.setDenied(null);
  setters.setError(null);
  if (hit) {
    setters.setMarkdown(hit.markdown);
    document.title = `${titleFromMarkdown(hit.markdown)} · MiyulabMD`;
    setters.setLoading(false);
    void loadOgCards(hit.markdown);
    return hit;
  }
  setters.setLoading(true);
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
    if (!hit) {
      applyShareFailure(result, setters);
    }
    setters.setLoading(false);
    return;
  }

  setters.setMarkdown(result.data.markdown);
  document.title = `${titleFromMarkdown(result.data.markdown)} · MiyulabMD`;
  setters.setLoading(false);
  void loadOgCards(result.data.markdown);
}

export function subscribeShareNote(id: string, setters: ShareLoadSetters) {
  const hit = beginShareNoteLoad(id, setters);
  let cancelled = false;
  void loadNote(id, Boolean(hit)).then((result) => {
    applyShareNoteLoad(result, hit, cancelled, setters);
  });
  return () => {
    cancelled = true;
  };
}

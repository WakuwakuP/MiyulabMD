import type { Note } from "@miyulabmd/shared";

import { type ApiResult, requestJson } from "./api-transport.ts";

type NoteRequestOptions = {
  signal?: AbortSignal;
  viewerId?: string;
};

type Subscriber = {
  reject: (reason: unknown) => void;
  resolve: (result: ApiResult<Note>) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

type Entry = {
  controller: AbortController;
  promise: Promise<ApiResult<Note>>;
  subscribers: Set<Subscriber>;
};

const inFlightByViewer = new Map<string, Map<string, Entry>>();

function copyResult(result: ApiResult<Note>): ApiResult<Note> {
  return result.ok ? { data: structuredClone(result.data), ok: true } : result;
}

function removeEntry(viewerId: string, id: string, entry: Entry): void {
  const byNote = inFlightByViewer.get(viewerId);
  if (byNote?.get(id) !== entry) {
    return;
  }
  byNote.delete(id);
  if (byNote.size === 0) {
    inFlightByViewer.delete(viewerId);
  }
}

function shareNoteRequest(
  id: string,
  viewerId: string,
  signal?: AbortSignal,
): Promise<ApiResult<Note>> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }

  let byNote = inFlightByViewer.get(viewerId);
  if (!byNote) {
    byNote = new Map();
    inFlightByViewer.set(viewerId, byNote);
  }
  let entry = byNote.get(id);
  if (!entry) {
    const controller = new AbortController();
    entry = {
      controller,
      promise: requestJson<Note>(`/api/notes/${id}`, {
        credentials: "include",
        signal: controller.signal,
      }),
      subscribers: new Set(),
    };
    byNote.set(id, entry);
    entry.promise.then(
      (result) => {
        removeEntry(viewerId, id, entry as Entry);
        for (const subscriber of entry?.subscribers ?? []) {
          if (subscriber.onAbort) {
            subscriber.signal?.removeEventListener("abort", subscriber.onAbort);
          }
          subscriber.resolve(copyResult(result));
        }
        entry?.subscribers.clear();
      },
      (error) => {
        removeEntry(viewerId, id, entry as Entry);
        for (const subscriber of entry?.subscribers ?? []) {
          if (subscriber.onAbort) {
            subscriber.signal?.removeEventListener("abort", subscriber.onAbort);
          }
          subscriber.reject(error);
        }
        entry?.subscribers.clear();
      },
    );
  }

  const currentEntry = entry;
  return new Promise<ApiResult<Note>>((resolve, reject) => {
    const subscriber: Subscriber = { reject, resolve, signal };
    subscriber.onAbort = () => {
      currentEntry.subscribers.delete(subscriber);
      signal?.removeEventListener("abort", subscriber.onAbort as () => void);
      reject(signal?.reason);
      if (currentEntry.subscribers.size === 0) {
        removeEntry(viewerId, id, currentEntry);
        currentEntry.controller.abort();
      }
    };
    currentEntry.subscribers.add(subscriber);
    signal?.addEventListener("abort", subscriber.onAbort, { once: true });
    if (signal?.aborted) {
      subscriber.onAbort();
    }
  });
}

export function fetchNoteRequest(
  id: string,
  options: NoteRequestOptions = {},
): Promise<ApiResult<Note>> {
  if (!options.viewerId) {
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason);
    }
    return requestJson<Note>(`/api/notes/${id}`, {
      credentials: "include",
      signal: options.signal,
    });
  }
  return shareNoteRequest(id, options.viewerId, options.signal);
}

import { collectImageUrls } from "@miyulabmd/markdown";
import { apiFetch } from "./api-fetch.ts";
import {
  assertOfflineCacheScope,
  isSupportedCachedImageMime,
  type OfflineCacheScope,
  openOfflineCache,
  suspendOfflineCacheUser,
} from "./offline-cache.ts";

export type AttachedImage = { url: string; noteId: string; imageId: string };

/** Resolve only the app's image API. The referenced parent can differ from the viewed note. */
export function attachedImage(
  url: string,
  origin = location.origin,
): AttachedImage | null {
  try {
    const parsed = new URL(url, origin);
    if (
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    const match = /^\/api\/notes\/([^/]+)\/images\/([^/]+)$/.exec(
      parsed.pathname,
    );
    if (!match) {
      return null;
    }
    const noteId = decodeURIComponent(match[1] as string);
    const imageId = decodeURIComponent(match[2] as string);
    if (!(noteId && imageId) || /[/\\]/.test(noteId + imageId)) {
      return null;
    }
    return {
      imageId,
      noteId,
      url: `/api/notes/${encodeURIComponent(noteId)}/images/${encodeURIComponent(imageId)}`,
    };
  } catch {
    return null;
  }
}

export function collectAttachedImages(
  markdown: string,
  origin = location.origin,
): AttachedImage[] {
  const images = new Map<string, AttachedImage>();
  for (const url of collectImageUrls(markdown)) {
    const image = attachedImage(url, origin);
    if (image) {
      images.set(image.url, image);
    }
  }
  return [...images.values()];
}

type Options = {
  scope: OfflineCacheScope;
  cacheOnly: boolean;
  signal?: AbortSignal;
};
type Entry = {
  controller: AbortController;
  promise: Promise<Blob | null>;
  users: number;
};
const inFlight = new Map<string, Entry>();
type ImageCache = Awaited<ReturnType<typeof openOfflineCache>>;

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason;
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: network status, durable denial, and optional cache fallback have separate semantics.
async function readNetworkImage(
  image: AttachedImage,
  cache: ImageCache | null,
  scope: OfflineCacheScope,
  signal?: AbortSignal,
): Promise<Blob | null> {
  const orderingToken = cache
    ? await cache.beginImageRead(image.noteId, image.imageId)
    : undefined;
  const response = await apiFetch(
    image.url,
    {
      cache: "no-store",
      credentials: "include",
      redirect: "error",
      signal,
    },
    { viewerId: scope.userId },
  );
  checkAbort(signal);
  if ([401, 403, 404].includes(response.status)) {
    // A definitive image denial must never turn into a stale image fallback.
    try {
      if (!cache) {
        throw new Error("Image denial storage unavailable");
      }
      await cache.denyImage(image.noteId, image.imageId, orderingToken);
    } catch {
      suspendOfflineCacheUser(scope.userId);
    }
    return null;
  }
  if (response.status >= 500 && response.status <= 599) {
    return cache ? await cache.getImage(image.noteId, image.imageId) : null;
  }
  if (!response.ok || response.redirected) {
    return null;
  }
  const mime =
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ??
    "";
  if (!isSupportedCachedImageMime(mime)) {
    return null;
  }
  const bytes = new Blob([await response.blob()], { type: mime });
  checkAbort(signal);
  await assertOfflineCacheScope(scope);
  try {
    await cache?.putImage(image.noteId, image.imageId, bytes, {
      orderingToken,
      signal,
    });
  } catch (error) {
    checkAbort(signal);
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    // Failed replacements leave the old committed reference intact.
  }
  return bytes;
}

async function loadImage(
  image: AttachedImage,
  options: Options,
): Promise<Blob | null> {
  const { scope, signal, cacheOnly } = options;
  checkAbort(signal);
  await assertOfflineCacheScope(scope);
  let cache: ImageCache | null = null;
  try {
    try {
      cache = await openOfflineCache({ scope, signal, userId: scope.userId });
    } catch {
      checkAbort(signal);
      // A healthy online image does not depend on optional local storage.
    }
    if (cacheOnly) {
      return cache ? await cache.getImage(image.noteId, image.imageId) : null;
    }
    try {
      return await readNetworkImage(image, cache, scope, signal);
    } catch (error) {
      checkAbort(signal);
      if (!(error instanceof TypeError)) {
        throw error;
      }
      return cache ? await cache.getImage(image.noteId, image.imageId) : null;
    }
  } finally {
    cache?.close();
  }
}

/** One acquisition for foreground and prefetch; cancellation belongs to each consumer. */
export async function acquireAttachedImage(
  image: AttachedImage,
  options: Options,
): Promise<Blob | null> {
  const { scope, signal, cacheOnly } = options;
  checkAbort(signal);
  const target = attachedImage(image.url);
  if (
    !target ||
    target.noteId !== image.noteId ||
    target.imageId !== image.imageId
  ) {
    return null;
  }
  await assertOfflineCacheScope(scope);
  checkAbort(signal);
  const key = JSON.stringify([
    scope.userId,
    scope.epoch,
    scope.lifetime,
    cacheOnly,
    image.url,
  ]);
  let entry = inFlight.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = {
      controller,
      promise: loadImage(image, {
        cacheOnly,
        scope,
        signal: controller.signal,
      }),
      users: 0,
    };
    inFlight.set(key, entry);
    const current = entry;
    const remove = () => {
      if (inFlight.get(key) === current) {
        inFlight.delete(key);
      }
    };
    void entry.promise.then(remove, remove);
  }
  const current = entry;
  current.users += 1;
  const bytes = await new Promise<Blob | null>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (settled) {
        return false;
      }
      settled = true;
      signal?.removeEventListener("abort", abort);
      current.users -= 1;
      if (!current.users) {
        if (inFlight.get(key) === current) {
          inFlight.delete(key);
        }
        current.controller.abort();
      }
      return true;
    };
    const abort = () => {
      if (cleanup()) {
        reject(signal?.reason);
      }
    };
    signal?.addEventListener("abort", abort, { once: true });
    void current.promise.then(
      (value) => {
        if (cleanup()) {
          resolve(value);
        }
      },
      (error) => {
        if (cleanup()) {
          reject(error);
        }
      },
    );
    if (signal?.aborted) {
      abort();
    }
  });
  checkAbort(signal);
  await assertOfflineCacheScope(scope);
  checkAbort(signal);
  return bytes;
}

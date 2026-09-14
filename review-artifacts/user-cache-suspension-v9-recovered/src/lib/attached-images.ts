import { collectImageUrls } from "@miyulabmd/markdown";
import { apiFetch } from "../../api-fetch.ts";
import { ApiIdentityError } from "../../api-transport.ts";
import {
  assertOfflineCacheScope,
  isSupportedCachedImageMime,
  type OfflineCacheScope,
  openOfflineCache,
  suspendOfflineCacheUser,
} from "./offline-cache.ts";
import type { StorageWriteRecovery } from "./storage-write-recovery.ts";

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
  requireCache?: boolean;
  signal?: AbortSignal;
  storageRecovery?: StorageWriteRecovery;
};
type CacheFailure = {
  error: unknown;
  retry(signal: AbortSignal): Promise<void>;
};
type LoadedImage = {
  bytes: Blob | null;
  cacheFailure?: CacheFailure;
};
type Entry = {
  controller: AbortController;
  promise: Promise<LoadedImage>;
  users: number;
};
const inFlight = new Map<string, Entry>();
const networkInFlight = new Map<string, Entry>();
type ImageCache = Awaited<ReturnType<typeof openOfflineCache>>;

export class AttachedImageCacheError extends Error {
  cause: unknown;

  constructor(cause: unknown) {
    super("Attached image cache write failed");
    this.cause = cause;
  }
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason;
  }
}

async function writeImageToFreshCache(
  image: AttachedImage,
  bytes: Blob,
  scope: OfflineCacheScope,
  orderingToken: number | undefined,
  signal: AbortSignal,
): Promise<void> {
  const cache = await openOfflineCache({
    scope,
    signal,
    userId: scope.userId,
  });
  try {
    const token =
      orderingToken ??
      (await cache.beginImageRead(image.noteId, image.imageId));
    await cache.putImage(image.noteId, image.imageId, bytes, {
      orderingToken: token,
      signal,
    });
  } finally {
    cache.close();
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: network status, durable denial, and optional cache fallback have separate semantics.
async function readNetworkImage(
  image: AttachedImage,
  cache: ImageCache | null,
  cacheOpenError: unknown,
  scope: OfflineCacheScope,
  signal?: AbortSignal,
): Promise<LoadedImage> {
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
    return { bytes: null };
  }
  if (response.status >= 500 && response.status <= 599) {
    return {
      bytes: cache ? await cache.getImage(image.noteId, image.imageId) : null,
    };
  }
  if (!response.ok || response.redirected) {
    return { bytes: null };
  }
  const mime =
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ??
    "";
  if (!isSupportedCachedImageMime(mime)) {
    return { bytes: null };
  }
  const bytes = new Blob([await response.blob()], { type: mime });
  checkAbort(signal);
  await assertOfflineCacheScope(scope);
  const retry = (retrySignal: AbortSignal) =>
    writeImageToFreshCache(image, bytes, scope, orderingToken, retrySignal);
  if (!cache) {
    return {
      bytes,
      cacheFailure: {
        error: cacheOpenError ?? new Error("Image cache storage unavailable"),
        retry,
      },
    };
  }
  try {
    await cache.putImage(image.noteId, image.imageId, bytes, {
      orderingToken,
      signal,
    });
  } catch (error) {
    checkAbort(signal);
    if (error instanceof DOMException && error.name === "AbortError") {
      return { bytes: null };
    }
    // Failed replacements leave the old committed reference intact.
    return { bytes, cacheFailure: { error, retry } };
  }
  return { bytes };
}

async function loadImage(
  image: AttachedImage,
  options: Options,
): Promise<LoadedImage> {
  const { scope, signal, cacheOnly } = options;
  checkAbort(signal);
  await assertOfflineCacheScope(scope);
  let cache: ImageCache | null = null;
  let cacheOpenError: unknown;
  try {
    try {
      cache = await openOfflineCache({ scope, signal, userId: scope.userId });
    } catch (error) {
      checkAbort(signal);
      cacheOpenError = error;
      // A healthy online image does not depend on optional local storage.
    }
    if (cacheOnly) {
      return {
        bytes: cache ? await cache.getImage(image.noteId, image.imageId) : null,
      };
    }
    try {
      return await readNetworkImage(
        image,
        cache,
        cacheOpenError,
        scope,
        signal,
      );
    } catch (error) {
      checkAbort(signal);
      if (!(error instanceof TypeError)) {
        throw error;
      }
      return {
        bytes: cache ? await cache.getImage(image.noteId, image.imageId) : null,
      };
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
  const {
    scope,
    signal = new AbortController().signal,
    cacheOnly,
    requireCache,
    storageRecovery,
  } = options;
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
  const loaded = await new Promise<LoadedImage>((resolve, reject) => {
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
  if (requireCache && loaded.cacheFailure) {
    try {
      if (!storageRecovery) {
        throw loaded.cacheFailure.error;
      }
      await storageRecovery.recover(
        loaded.cacheFailure.error,
        () => loaded.cacheFailure?.retry(signal) ?? Promise.resolve(),
        signal,
      );
    } catch (error) {
      checkAbort(signal);
      throw new AttachedImageCacheError(error);
    }
  }
  return loaded.bytes;
}

function discardImageResponse(response: Response): void {
  void response.body?.cancel().catch(() => {
    // A rejected body must not become a preview fallback.
  });
}

async function readNetworkOnlyResponse(
  response: Response,
  signal: AbortSignal,
): Promise<Blob | null> {
  if (
    response.redirected ||
    !response.ok ||
    response.status < 200 ||
    response.status >= 300
  ) {
    discardImageResponse(response);
    return null;
  }
  const mime =
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ??
    "";
  if (!isSupportedCachedImageMime(mime)) {
    discardImageResponse(response);
    return null;
  }
  const body = await response.blob();
  checkAbort(signal);
  return body.size === 0 ? null : new Blob([body], { type: mime });
}

/**
 * Read an attachment over the network without opening or consulting local
 * storage. The expected identity is captured in the transport key and is
 * never inferred from the response.
 */
export async function acquireAttachedImageNetworkOnly(
  image: AttachedImage,
  options: { expectedViewerId: string | null; signal?: AbortSignal },
): Promise<Blob | null> {
  const { expectedViewerId, signal = new AbortController().signal } = options;
  checkAbort(signal);
  const target = attachedImage(image.url);
  if (
    !target ||
    target.noteId !== image.noteId ||
    target.imageId !== image.imageId
  ) {
    return null;
  }
  const key = JSON.stringify([expectedViewerId, image.url]);
  let entry = networkInFlight.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = {
      controller,
      promise: (async () => {
        try {
          const response = await apiFetch(
            image.url,
            {
              cache: "no-store",
              credentials: "include",
              redirect: "error",
              signal: controller.signal,
            },
            { viewerId: expectedViewerId },
          );
          checkAbort(controller.signal);
          checkAbort(controller.signal);
          return {
            bytes: await readNetworkOnlyResponse(response, controller.signal),
          };
        } catch (error) {
          checkAbort(controller.signal);
          // Identity mismatches are already published to identity listeners
          // by apiFetch; their response body is intentionally not exposed.
          if (error instanceof TypeError || error instanceof ApiIdentityError) {
            return { bytes: null };
          }
          throw error;
        }
      })(),
      users: 0,
    };
    networkInFlight.set(key, entry);
    const current = entry;
    const remove = () => {
      if (networkInFlight.get(key) === current) {
        networkInFlight.delete(key);
      }
    };
    void entry.promise.then(remove, remove);
  }
  const current = entry;
  current.users += 1;
  return new Promise<Blob | null>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (settled) return false;
      settled = true;
      signal.removeEventListener("abort", abort);
      current.users -= 1;
      if (!current.users) {
        if (networkInFlight.get(key) === current) networkInFlight.delete(key);
        current.controller.abort();
      }
      return true;
    };
    const abort = () => {
      if (cleanup()) reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    void current.promise.then(
      (value) => {
        if (cleanup()) resolve(value.bytes);
      },
      (error) => {
        if (cleanup()) reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

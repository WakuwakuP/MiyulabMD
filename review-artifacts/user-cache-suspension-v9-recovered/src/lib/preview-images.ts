import { useEffect, useMemo, useState } from "react";
import {
  attachedImage,
  collectAttachedImages,
} from "./attached-image-target.ts";
import { acquireAttachedImageNetworkOnly } from "./network-attached-images.ts";
import type { ViewerContext } from "./viewer-context.ts";

export type ImageViewContext = {
  viewer: ViewerContext;
  source: "network" | "cache";
};

type Images = { owner: string; urls: Map<string, string | null> };
type AcquisitionMode =
  | "cache"
  | "cache-backed-network"
  | "network-only"
  | "disabled";

function acquisitionMode(context?: ImageViewContext): AcquisitionMode {
  if (!context) return "disabled";
  const { viewer } = context;
  if (context.source === "cache") {
    return viewer.cacheViewerId ? "cache" : "disabled";
  }
  if (viewer.mode === "guest") return "network-only";
  if (viewer.mode !== "authenticated" || !viewer.user?.id) return "disabled";
  if (viewer.cacheViewerId === null) return "network-only";
  return viewer.cacheViewerId === viewer.user.id
    ? "cache-backed-network"
    : "disabled";
}

function ownImageUrl(
  bytes: Blob | null,
  ownedUrls: Set<string>,
): string | null {
  if (!bytes) {
    return null;
  }
  const url = URL.createObjectURL(bytes);
  ownedUrls.add(url);
  return url;
}

/** Blob URLs belong to the preview, never to the acquisition/cache or Markdown. */
export function usePreviewImages(markdown: string, context?: ImageViewContext) {
  const mode = acquisitionMode(context);
  const cacheOnly = mode === "cache";
  const userId = context?.viewer.cacheViewerId ?? null;
  const expectedViewerId =
    mode === "network-only" && context?.viewer.mode !== "guest"
      ? context?.viewer.user?.id ?? null
      : mode === "network-only"
        ? null
        : undefined;
  const enabled = mode !== "disabled";
  const owner = JSON.stringify([
    mode,
    enabled,
    userId,
    expectedViewerId,
    cacheOnly,
    markdown,
  ]);
  const [images, setImages] = useState<Images | null>(null);
  useEffect(() => {
    if (!enabled || (cacheOnly && !userId)) {
      return;
    }
    const controller = new AbortController();
    const ownedUrls = new Set<string>();
    const urls = new Map<string, string | null>();
    const targets = collectAttachedImages(markdown);
    const blocked = new Set<string>();
    const forgetImage = (imageUrl: string) => {
      blocked.add(imageUrl);
      const blobUrl = urls.get(imageUrl);
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        ownedUrls.delete(blobUrl);
      }
      urls.set(imageUrl, null);
      setImages({ owner, urls: new Map(urls) });
    };
    const revoke = () => {
      controller.abort();
      for (const url of ownedUrls) {
        URL.revokeObjectURL(url);
      }
      ownedUrls.clear();
    };
    let unsubscribeImage: (() => void) | undefined;
    let unsubscribeNote: (() => void) | undefined;
    let unsubscribeRealm: (() => void) | undefined;
    const usesCache = mode !== "network-only";
    const initialize = async () => {
      if (usesCache) {
        const cache = await import("./offline-cache.ts");
        if (controller.signal.aborted) return;
        unsubscribeImage = cache.subscribeOfflineCacheImageInvalidation((event) => {
          if (
            event.userId !== userId ||
            !event.resource ||
            !targets.some(
              (image) =>
                image.noteId === event.resource.noteId &&
                image.imageId === event.resource.imageId,
            )
          ) {
            return;
          }
          const imageUrl = targets.find(
            (image) =>
              image.noteId === event.resource?.noteId &&
              image.imageId === event.resource?.imageId,
          )?.url;
          if (imageUrl) {
            forgetImage(imageUrl);
          }
        });
        unsubscribeNote = cache.subscribeOfflineCacheNoteDenial((event) => {
          if (event.userId !== userId || controller.signal.aborted) {
            return;
          }
          for (const image of targets) {
            if (!event.resource.aliases.includes(image.noteId)) {
              continue;
            }
            void cache.readOfflineNoteDenial(event, [image.noteId])
              .then((denied) => {
                if (!controller.signal.aborted && denied !== false) {
                  forgetImage(image.url);
                }
              })
              .catch(() => {
                // A target notification must not fail the independent note body.
              });
          }
        });
        unsubscribeRealm = cache.subscribeOfflineCacheInvalidation((invalidatedUser) => {
          if (invalidatedUser !== userId) {
            return;
          }
          revoke();
          setImages({ owner, urls: new Map() });
        });
        const scope = await cache.captureOfflineCacheScope(userId as string);
        if (controller.signal.aborted) return;
        await Promise.all(
          targets.map(async (image) => {
            let bytes: Blob | null = null;
            try {
              bytes = await cache.acquireAttachedImage(image, {
                cacheOnly,
                scope,
                signal: controller.signal,
              });
            } catch {
              // A failed attachment must not replace or fail the note body.
            }
            if (controller.signal.aborted || blocked.has(image.url)) return;
            const url = ownImageUrl(bytes, ownedUrls);
            urls.set(image.url, url);
            setImages({ owner, urls: new Map(urls) });
          }),
        );
      } else {
        await Promise.all(
          targets.map(async (image) => {
            let bytes: Blob | null = null;
            try {
              bytes = await acquireAttachedImageNetworkOnly(image, {
                expectedViewerId: expectedViewerId as string | null,
                signal: controller.signal,
              });
            } catch {
              // A failed attachment must not replace or fail the note body.
            }
            if (controller.signal.aborted || blocked.has(image.url)) return;
            const url = ownImageUrl(bytes, ownedUrls);
            urls.set(image.url, url);
            setImages({ owner, urls: new Map(urls) });
          }),
        );
      }
      if (controller.signal.aborted) return;
      for (const image of targets) {
        if (!urls.has(image.url)) urls.set(image.url, null);
      }
      setImages({ owner, urls: new Map(urls) });
    };
    void initialize().catch(() => {});
    return () => {
      unsubscribeImage?.();
      unsubscribeNote?.();
      unsubscribeRealm?.();
      revoke();
    };
  }, [cacheOnly, enabled, markdown, owner, userId, expectedViewerId, mode]);
  return useMemo(
    () => ({
      enabled,
      urls:
        images?.owner === owner
          ? images.urls
          : new Map<string, string | null>(),
    }),
    [enabled, images, owner],
  );
}

/** Input is already sanitized HTML. Only owned blob URLs are inserted afterwards.
 * A detached template prevents duplicate browser downloads of pending API images.
 * Without a view resolver, preserve the renderer's exact output.
 */
export function resolvePreviewImages(
  html: string,
  images: { enabled: boolean; urls: Map<string, string | null> },
): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const node of template.content.querySelectorAll("img")) {
    const image = attachedImage(node.getAttribute("src") ?? "");
    if (!image) {
      continue;
    }
    const url = images.enabled ? images.urls.get(image.url) : null;
    if (url) {
      node.src = url;
    } else {
      node.removeAttribute("src");
      const message = document.createElement("span");
      message.setAttribute("role", "status");
      message.textContent =
        !images.enabled || url === null
          ? "画像を表示できません（未保存または閲覧不可）。"
          : "画像を読み込み中…";
      node.after(message);
    }
  }
  return template.innerHTML;
}

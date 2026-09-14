import { useEffect, useMemo, useState } from "react";
import {
  acquireAttachedImage,
  attachedImage,
  collectAttachedImages,
} from "./attached-images.ts";
import {
  captureOfflineCacheScope,
  readOfflineNoteDenial,
  subscribeOfflineCacheImageInvalidation,
  subscribeOfflineCacheInvalidation,
  subscribeOfflineCacheNoteDenial,
} from "./offline-cache.ts";
import type { ViewerContext } from "./viewer-context.ts";

export type ImageViewContext = {
  viewer: ViewerContext;
  source: "network" | "cache";
};

type Images = { owner: string; urls: Map<string, string | null> };

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
  const userId = context?.viewer.cacheViewerId ?? null;
  const cacheOnly = context?.source === "cache";
  const enabled =
    Boolean(userId) && (cacheOnly || context?.viewer.user?.id === userId);
  const owner = JSON.stringify([enabled, userId, cacheOnly, markdown]);
  const [images, setImages] = useState<Images | null>(null);
  useEffect(() => {
    if (!(enabled && userId)) {
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
    const unsubscribeImage = subscribeOfflineCacheImageInvalidation((event) => {
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
    const unsubscribeNote = subscribeOfflineCacheNoteDenial((event) => {
      if (event.userId !== userId || controller.signal.aborted) {
        return;
      }
      for (const image of targets) {
        if (!event.resource.aliases.includes(image.noteId)) {
          continue;
        }
        void readOfflineNoteDenial(event, [image.noteId])
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
    const unsubscribeRealm = subscribeOfflineCacheInvalidation(
      (invalidatedUser) => {
        if (invalidatedUser !== userId) {
          return;
        }
        revoke();
        setImages({ owner, urls: new Map() });
      },
    );
    void captureOfflineCacheScope(userId)
      .then(async (scope) => {
        await Promise.all(
          targets.map(async (image) => {
            let bytes: Blob | null = null;
            try {
              bytes = await acquireAttachedImage(image, {
                cacheOnly,
                scope,
                signal: controller.signal,
              });
            } catch {
              // A failed attachment must not replace or fail the note body.
            }
            if (controller.signal.aborted || blocked.has(image.url)) {
              return;
            }
            const url = ownImageUrl(bytes, ownedUrls);
            urls.set(image.url, url);
            setImages({ owner, urls: new Map(urls) });
          }),
        );
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return;
        }
        setImages({
          owner,
          urls: new Map(targets.map((image) => [image.url, null])),
        });
      });
    return () => {
      unsubscribeImage();
      unsubscribeNote();
      unsubscribeRealm();
      revoke();
    };
  }, [cacheOnly, enabled, markdown, owner, userId]);
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
  if (!images.enabled) {
    return html;
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const node of template.content.querySelectorAll("img")) {
    const image = attachedImage(node.getAttribute("src") ?? "");
    if (!image) {
      continue;
    }
    const url = images.urls.get(image.url);
    if (url) {
      node.src = url;
    } else {
      node.removeAttribute("src");
      const message = document.createElement("span");
      message.setAttribute("role", "status");
      message.textContent =
        url === null
          ? "画像を表示できません（未保存または閲覧不可）。"
          : "画像を読み込み中…";
      node.after(message);
    }
  }
  return template.innerHTML;
}

import {
  isBlockedHost,
  OG_TARGET_HEADER,
  type OgOutbound,
  ogRequestInit,
} from "../og-fetch-shared.ts";

export type OgPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 512_000;

export const OG_CACHE_CONTROL = "public, max-age=300, s-maxage=3600";

const ogInflight = new Map<
  string,
  Promise<OgPreview | { error: string; status: number }>
>();

function decodeEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function metaContent(html: string, keys: string[]): string | null {
  for (const key of keys) {
    const property = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']+)["']`,
      "i",
    );
    const contentFirst = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${key}["']`,
      "i",
    );
    const match = property.exec(html) ?? contentFirst.exec(html);
    if (match?.[1]) return decodeEntities(match[1].trim());
  }
  return null;
}

function titleTag(html: string): string | null {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return match?.[1]?.trim() ? decodeEntities(match[1].trim()) : null;
}

function resolveUrl(base: string, value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value, base).toString();
  } catch {
    return null;
  }
}

export function parseOgHtml(html: string, baseUrl: string): OgPreview {
  const title =
    metaContent(html, ["og:title", "twitter:title"]) ?? titleTag(html);
  const description = metaContent(html, [
    "og:description",
    "twitter:description",
    "description",
  ]);
  const image = resolveUrl(
    baseUrl,
    metaContent(html, ["og:image", "twitter:image"]),
  );
  const siteName = metaContent(html, ["og:site_name"]);
  return {
    url: baseUrl,
    title,
    description,
    image,
    siteName,
  };
}

async function readHtmlPrefix(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const body = response.body;
  if (!body) return (await response.text()).slice(0, maxBytes);

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  try {
    while (html.length < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
  return html.slice(0, maxBytes);
}

export function ogCacheKey(origin: string, rawUrl: string): Request | null {
  try {
    const target = new URL(rawUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return null;
    }
    return new Request(
      `${origin}/api/og?url=${encodeURIComponent(target.toString())}`,
      { method: "GET" },
    );
  } catch {
    return null;
  }
}

export async function matchOgCache(
  origin: string,
  rawUrl: string,
): Promise<OgPreview | null> {
  const key = ogCacheKey(origin, rawUrl);
  if (!key) return null;
  const hit = await caches.default.match(key);
  if (!hit?.ok) return null;
  try {
    return (await hit.json()) as OgPreview;
  } catch {
    return null;
  }
}

export async function putOgCache(
  origin: string,
  preview: OgPreview,
): Promise<void> {
  const key = ogCacheKey(origin, preview.url);
  if (!key) return;
  await caches.default.put(
    key,
    new Response(JSON.stringify(preview), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": OG_CACHE_CONTROL,
      },
    }),
  );
}

export async function peekOgCards(
  origin: string,
  urls: string[],
): Promise<Map<string, OgPreview>> {
  const cards = new Map<string, OgPreview>();
  await Promise.all(
    urls.map(async (url) => {
      const card = await matchOgCache(origin, url);
      if (card) cards.set(url, card);
    }),
  );
  return cards;
}

async function fetchHtml(
  url: string,
  init: RequestInit,
  outbound?: OgOutbound,
): Promise<Response> {
  if (outbound) {
    try {
      const headers = new Headers(init.headers);
      headers.set(OG_TARGET_HEADER, url);
      const viaOutbound = await outbound.fetch("https://og-fetch.internal/", {
        ...init,
        headers,
      });
      if (viaOutbound.ok) return viaOutbound;
    } catch {
      // Custom-domain Workers cannot fetch some same-zone CNAMEs.
      // Fall through to the runtime fetch (works on workers.dev / local).
    }
  }
  return fetch(url, init);
}

export async function fetchOgPreview(
  rawUrl: string,
  outbound?: OgOutbound,
): Promise<OgPreview | { error: string; status: number }> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return { error: "invalid url", status: 400 };
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return { error: "unsupported protocol", status: 400 };
  }
  if (isBlockedHost(target.hostname)) {
    return { error: "blocked host", status: 400 };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchHtml(
      target.toString(),
      ogRequestInit(controller.signal),
      outbound,
    );
    if (!response.ok) {
      return { error: "fetch failed", status: 502 };
    }
    const html = await readHtmlPrefix(response, MAX_BYTES);
    return parseOgHtml(html, target.toString());
  } catch {
    return { error: "fetch failed", status: 502 };
  } finally {
    clearTimeout(timer);
  }
}

export async function loadOgPreview(
  origin: string,
  rawUrl: string,
  outbound?: OgOutbound,
): Promise<OgPreview | { error: string; status: number }> {
  const cached = await matchOgCache(origin, rawUrl);
  if (cached) return cached;

  const key = ogCacheKey(origin, rawUrl);
  const inflightKey = key?.url ?? rawUrl;
  const existing = ogInflight.get(inflightKey);
  if (existing) return existing;

  const pending = fetchOgPreview(rawUrl, outbound)
    .then(async (result) => {
      if (!("error" in result)) await putOgCache(origin, result);
      return result;
    })
    .finally(() => {
      ogInflight.delete(inflightKey);
    });
  ogInflight.set(inflightKey, pending);
  return pending;
}

export async function warmOgCards(
  origin: string,
  urls: string[],
  outbound?: OgOutbound,
): Promise<void> {
  await Promise.all(urls.map((url) => loadOgPreview(origin, url, outbound)));
}

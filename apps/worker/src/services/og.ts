export type OgPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
};

const FETCH_TIMEOUT_MS = 5000;
const MAX_BYTES = 512_000;

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1"
  ) {
    return true;
  }
  if (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return true;
  }
  return false;
}

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

export async function fetchOgPreview(
  rawUrl: string,
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
    const response = await fetch(target.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) {
      return { error: "fetch failed", status: 502 };
    }
    const html = (await response.text()).slice(0, MAX_BYTES);
    const title =
      metaContent(html, ["og:title", "twitter:title"]) ?? titleTag(html);
    const description = metaContent(html, [
      "og:description",
      "twitter:description",
      "description",
    ]);
    const image = resolveUrl(
      target.toString(),
      metaContent(html, ["og:image", "twitter:image"]),
    );
    const siteName = metaContent(html, ["og:site_name"]);
    return {
      url: target.toString(),
      title,
      description,
      image,
      siteName,
    };
  } catch {
    return { error: "fetch failed", status: 502 };
  } finally {
    clearTimeout(timer);
  }
}

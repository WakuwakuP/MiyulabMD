export const OG_USER_AGENT =
  "Mozilla/5.0 (compatible; MiyulabMD-OGP/1.0; +https://md.miyulab.dev)";

export const OG_ACCEPT = "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8";

/** Service bindings rewrite request.url to this Worker; pass the page URL here. */
export const OG_TARGET_HEADER = "x-og-target";

export function parseOgTargetUrl(request: Request): URL | null {
  const raw = request.headers.get(OG_TARGET_HEADER);
  if (!raw) return null;
  try {
    const target = new URL(raw);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return null;
    }
    if (
      isBlockedHost(target.hostname) ||
      target.hostname.endsWith(".workers.dev")
    ) {
      return null;
    }
    return target;
  } catch {
    return null;
  }
}

export type OgOutbound = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

export function isBlockedHost(hostname: string): boolean {
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
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^169\.254\./.test(host)
  ) {
    return true;
  }
  return false;
}

export function ogRequestInit(signal?: AbortSignal): RequestInit {
  return {
    method: "GET",
    redirect: "follow",
    signal,
    headers: {
      Accept: OG_ACCEPT,
      "User-Agent": OG_USER_AGENT,
      "Accept-Language": "ja,en;q=0.8",
    },
  };
}

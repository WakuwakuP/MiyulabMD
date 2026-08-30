import { isBlockedHost, ogRequestInit } from "./og-fetch-shared.ts";

/**
 * Zone に載っていない outbound-only Worker。
 * md.miyulab.dev からの same-zone fetch では解決できない
 * CNAME（Vercel 等）へ、公開 DNS 経由で取りに行く。
 */
export default {
  async fetch(request: Request): Promise<Response> {
    let target: URL;
    try {
      target = new URL(request.url);
    } catch {
      return new Response("invalid url", { status: 400 });
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return new Response("unsupported protocol", { status: 400 });
    }
    if (isBlockedHost(target.hostname)) {
      return new Response("blocked host", { status: 400 });
    }
    if (target.hostname.endsWith(".workers.dev")) {
      return new Response("blocked host", { status: 400 });
    }
    return fetch(target.toString(), ogRequestInit(request.signal));
  },
};

import { DurableObject } from "cloudflare:workers";
import { handleCatalogList } from "./catalog-list.ts";
import { handleCatalogSearch, handleCatalogTree } from "./catalog-read.ts";
import { handleCatalogTool } from "./catalog-tool.ts";

/**
 * ユーザーごとの一覧・検索。本文の走査と JSON の組み立てはここで行い、
 * Worker はセッション確認とレスポンスの転送だけにする。公開 URL はない。
 */
export class CatalogRoom extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/tool") {
      return await handleCatalogTool(this.env, request);
    }
    if (path === "/search" || path.startsWith("/search/")) {
      return await handleCatalogSearch(this.env, request);
    }
    if (path === "/tree") {
      return await handleCatalogTree(this.env, request);
    }
    return await handleCatalogList(this.env, request);
  }
}

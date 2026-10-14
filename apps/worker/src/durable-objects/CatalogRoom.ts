import { DurableObject } from "cloudflare:workers";

import { handleCatalogList } from "./catalog-list.ts";

/**
 * ユーザーごとのノート一覧。本文は持たず、D1 の権限判定だけを Worker の
 * 10ms 枠の外で行う。公開 URL はなく、Worker からの stub.fetch だけで呼ぶ。
 */
export class CatalogRoom extends DurableObject<Env> {
  override async fetch(request: Request): Promise<Response> {
    return await handleCatalogList(this.env, request);
  }
}

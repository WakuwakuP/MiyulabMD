export const ARTICLE_CHANGED_EVENT = "miyulabmd:article-changed";

/** ヘッダーの「サイトを更新」が SPA 内の保存を拾えるようにする。 */
export function notifyArticleChanged(): void {
  window.dispatchEvent(new Event(ARTICLE_CHANGED_EVENT));
}

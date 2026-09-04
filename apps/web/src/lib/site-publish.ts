import { matchArticleSource } from "@miyulabmd/shared";

/** 現在フォルダがサイト設定配下ならそのソース。対象外・未指定なら null（ボタン非表示）。 */
export function matchingSiteSource<T extends { folder: string }>(
  folder: string | null | undefined,
  sources: T[],
): T | null {
  if (folder == null) return null;
  return matchArticleSource(folder, sources);
}

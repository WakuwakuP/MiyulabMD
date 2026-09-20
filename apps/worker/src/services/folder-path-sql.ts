/**
 * D1 の LIKE/GLOB パターンは 50 バイト上限。パス子孫は range scan で取る。
 * 区切りは `/` のみ。`'/' (0x2F) < '0' (0x30)` なので
 * `path || '0'` が `path/` 配下の排他上界になる。
 */

export type FolderPathFilter = {
  sql: string;
  binds: Array<string | number>;
};

/** `path` 自身と、その配下すべて。空パスはドライブ全体（呼び出し側の owner 条件に任せる）。 */
export function folderSubtreeFilter(
  path: string,
  column = "folder",
): FolderPathFilter {
  if (!path) {
    return { binds: [], sql: "1=1" };
  }
  return {
    binds: [path, `${path}/`, `${path}0`],
    sql: `(${column} = ? OR (${column} >= ? AND ${column} < ?))`,
  };
}

/**
 * `parent` の直下だけ。空 parent はトップレベル
 * （`/` を含まないパス）。
 */
export function folderDirectChildrenFilter(
  parent: string,
  column = "folder",
): FolderPathFilter {
  if (!parent) {
    return {
      binds: [],
      sql: `${column} != '' AND instr(${column}, '/') = 0`,
    };
  }
  return {
    binds: [`${parent}/`, `${parent}0`, parent],
    sql: `${column} >= ? AND ${column} < ? AND instr(substr(${column}, length(?) + 2), '/') = 0`,
  };
}

/**
 * 集合 UPDATE 用。`to || substr(col, length(from)+1)` は rewriteFolderPrefix と同じ。
 * 開始位置は SQLite の `length()`（Unicode 文字数）。JS の String.length
 * （UTF-16）を渡すと絵文字などで slash が落ちる。
 */
export function folderRewriteAssignment(
  from: string,
  to: string,
  column = "folder",
): { binds: [string, string]; sql: string } {
  return {
    binds: [to, from],
    sql: `${column} = ? || substr(${column}, length(?) + 1)`,
  };
}

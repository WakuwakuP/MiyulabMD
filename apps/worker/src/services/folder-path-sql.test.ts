import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { rewriteFolderPrefix } from "@miyulabmd/shared";
import {
  folderDirectChildrenFilter,
  folderRewriteBinds,
  folderSubtreeFilter,
} from "./folder-path-sql.ts";

function rowsMatching(
  db: DatabaseSync,
  filter: { sql: string; binds: Array<string | number> },
): string[] {
  const rows = db
    .prepare(`SELECT folder FROM paths WHERE ${filter.sql} ORDER BY folder`)
    .all(...filter.binds) as { folder: string }[];
  return rows.map((row) => row.folder);
}

function seedPaths(folders: string[]): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE paths (folder TEXT NOT NULL)");
  const insert = db.prepare("INSERT INTO paths (folder) VALUES (?)");
  for (const folder of folders) {
    insert.run(folder);
  }
  return db;
}

const SAMPLE = [
  "",
  "work",
  "work/infra",
  "work/infra/db",
  "workplace",
  "play",
  "a_b",
  "a_b/child",
  "10-19 ライフ/15 仕事/15.22 プロジェクト名",
  "10-19 ライフ/15 仕事/15.22 プロジェクト名/Resources",
  "10-19 ライフ/15 仕事/15.23 別",
];

test("folderSubtreeFilter includes the folder and descendants, not siblings", () => {
  const db = seedPaths(SAMPLE);
  try {
    assert.deepEqual(rowsMatching(db, folderSubtreeFilter("work")), [
      "work",
      "work/infra",
      "work/infra/db",
    ]);
    assert.deepEqual(rowsMatching(db, folderSubtreeFilter("workplace")), [
      "workplace",
    ]);
    assert.deepEqual(rowsMatching(db, folderSubtreeFilter("a_b")), [
      "a_b",
      "a_b/child",
    ]);
    const long = "10-19 ライフ/15 仕事/15.22 プロジェクト名";
    assert.ok(Buffer.byteLength(`${long}/%`, "utf8") > 50);
    assert.deepEqual(rowsMatching(db, folderSubtreeFilter(long)), [
      long,
      `${long}/Resources`,
    ]);
    assert.deepEqual(
      rowsMatching(db, folderSubtreeFilter("")),
      [...SAMPLE].sort(),
    );
  } finally {
    db.close();
  }
});

test("folderDirectChildrenFilter returns one level only", () => {
  const db = seedPaths(SAMPLE);
  try {
    assert.deepEqual(rowsMatching(db, folderDirectChildrenFilter("work")), [
      "work/infra",
    ]);
    assert.deepEqual(rowsMatching(db, folderDirectChildrenFilter("")), [
      "a_b",
      "play",
      "work",
      "workplace",
    ]);
    assert.deepEqual(
      rowsMatching(
        db,
        folderDirectChildrenFilter("10-19 ライフ/15 仕事/15.22 プロジェクト名"),
      ),
      ["10-19 ライフ/15 仕事/15.22 プロジェクト名/Resources"],
    );
  } finally {
    db.close();
  }
});

test("folder rewrite SQL matches rewriteFolderPrefix", () => {
  const db = seedPaths(["work", "work/infra", "work/infra/db", "workplace"]);
  try {
    const from = "work";
    const to = "play";
    const filter = folderSubtreeFilter(from);
    const { suffixStart } = folderRewriteBinds(from, to);
    db.prepare(
      `UPDATE paths SET folder = ? || substr(folder, ?) WHERE ${filter.sql}`,
    ).run(to, suffixStart, ...filter.binds);
    const next = db
      .prepare("SELECT folder FROM paths ORDER BY folder")
      .all() as { folder: string }[];
    assert.deepEqual(
      next.map((row) => row.folder),
      ["play", "play/infra", "play/infra/db", "workplace"],
    );
    assert.equal(rewriteFolderPrefix("work/infra", from, to), "play/infra");
  } finally {
    db.close();
  }
});

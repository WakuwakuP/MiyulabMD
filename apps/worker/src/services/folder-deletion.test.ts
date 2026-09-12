import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectFolderIds,
  collectNoteEvictionIds,
  listFoldersInSubtree,
  listNotesInFolderSubtree,
  noteEvictionIds,
} from "./folder-deletion.ts";

test("listNotesInFolderSubtree includes descendants only", () => {
  const notes = [
    { folder: "work", id: "n1", shortId: "s1" },
    { folder: "work/infra", id: "n2", shortId: "s2" },
    { folder: "play", id: "n3", shortId: "s3" },
  ];
  assert.deepEqual(
    listNotesInFolderSubtree(notes, "work").map((note) => note.id),
    ["n1", "n2"],
  );
});

test("listFoldersInSubtree includes descendants only", () => {
  const folders = [
    { folder: "work", id: "f1" },
    { folder: "work/infra", id: "f2" },
    { folder: "play", id: "f3" },
  ];
  assert.deepEqual(
    listFoldersInSubtree(folders, "work").map((folder) => folder.id),
    ["f1", "f2"],
  );
});

test("noteEvictionIds includes shortId when it differs", () => {
  assert.deepEqual(noteEvictionIds({ id: "uuid", shortId: "abc" }), [
    "uuid",
    "abc",
  ]);
  assert.deepEqual(noteEvictionIds({ id: "same", shortId: "same" }), ["same"]);
});

test("collect helpers flatten ids", () => {
  const notes = [
    { folder: "work", id: "n1", shortId: "s1" },
    { folder: "work/infra", id: "n2", shortId: "n2" },
  ];
  assert.deepEqual(collectNoteEvictionIds(notes), ["n1", "s1", "n2"]);
  assert.deepEqual(
    collectFolderIds([
      { folder: "work", id: "f1" },
      { folder: "work/infra", id: "f2" },
    ]),
    ["f1", "f2"],
  );
});

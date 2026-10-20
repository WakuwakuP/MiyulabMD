import assert from "node:assert/strict";
import { test } from "node:test";
import {
  drivePlaceFromSelection,
  drivePlacePath,
  readDrivePlace,
  writeDrivePlace,
} from "./drive-place.ts";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

test("drive place defaults to my drive", () => {
  assert.deepEqual(readDrivePlace(memoryStorage()), {
    kind: "mine",
    path: "/",
  });
});

test("drive place round-trips a shared drive and its folder", () => {
  const storage = memoryStorage();
  writeDrivePlace(
    { id: "drive-1", kind: "drive", path: "/f/folder-1" },
    storage,
  );
  assert.deepEqual(readDrivePlace(storage), {
    id: "drive-1",
    kind: "drive",
    path: "/f/folder-1",
  });
});

test("drive place rejects paths outside the drive tree", () => {
  const storage = memoryStorage();
  writeDrivePlace({ id: "drive-1", kind: "drive", path: "/shared" }, storage);
  assert.deepEqual(readDrivePlace(storage), {
    id: "drive-1",
    kind: "drive",
    path: "/d/drive-1",
  });
  assert.equal(
    drivePlacePath({ id: "drive-1", kind: "drive", path: "https://evil" }),
    "/d/drive-1",
  );
});

test("drive place ignores grant pages", () => {
  assert.equal(drivePlaceFromSelection({ kind: "shared" }, "/shared"), null);
  assert.equal(
    drivePlaceFromSelection({ kind: "shared-by-me" }, "/shared-by-me"),
    null,
  );
  assert.deepEqual(
    drivePlaceFromSelection({ id: "drive-1", kind: "drive" }, "/d/drive-1"),
    { id: "drive-1", kind: "drive", path: "/d/drive-1" },
  );
});

test("drive place ignores malformed storage", () => {
  const storage = memoryStorage();
  storage.setItem("miyulabmd:drive-place", "{");
  assert.deepEqual(readDrivePlace(storage), { kind: "mine", path: "/" });
  storage.setItem(
    "miyulabmd:drive-place",
    JSON.stringify({ id: "", kind: "drive", path: "/d/x" }),
  );
  assert.deepEqual(readDrivePlace(storage), { kind: "mine", path: "/" });
});

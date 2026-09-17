import assert from "node:assert/strict";
import { test } from "node:test";
import type { ParaPlan } from "@miyulabmd/shared";
import {
  initParaConflicts,
  paraConflictResolutions,
  paraConflictsReady,
  paraPlanConflicts,
  setParaConflictChoice,
  setParaConflictNewName,
} from "./para-conflict.ts";

function planWith(buckets: ParaPlan["buckets"]): ParaPlan {
  return { buckets, space: { status: "exists" } };
}

const collidingPlan = planWith([
  {
    bucket: "projects",
    existing: { id: "f-projects", name: "Projects" },
    status: "collision",
  },
  { bucket: "areas", status: "vacant" },
  { bucket: "resources", status: "assigned" },
  {
    bucket: "archives",
    existing: { id: "f-archives", name: "Archives" },
    status: "collision",
  },
]);

test("paraPlanConflicts picks only collision buckets", () => {
  assert.deepEqual(
    paraPlanConflicts(collidingPlan).map((bucket) => bucket.bucket),
    ["projects", "archives"],
  );
});

test("initParaConflicts defaults to rename with a suffixed name", () => {
  const items = initParaConflicts(collidingPlan);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.bucket, "projects");
  assert.equal(items[0]?.choice, "rename");
  assert.equal(items[0]?.newName, "Projects (old)");
  assert.equal(items[0]?.existingId, "f-projects");
});

test("paraConflictsReady requires a non-empty rename target", () => {
  const items = initParaConflicts(collidingPlan);
  assert.equal(paraConflictsReady(items), true);
  const emptied = setParaConflictNewName(items, "projects", "   ");
  assert.equal(paraConflictsReady(emptied), false);
  // adopt/skip are always ready.
  const adopted = setParaConflictChoice(emptied, "projects", "adopt");
  assert.equal(paraConflictsReady(adopted), true);
  const skipped = setParaConflictChoice(emptied, "projects", "skip");
  assert.equal(paraConflictsReady(skipped), true);
});

test("paraConflictResolutions maps each choice to the API shape", () => {
  let items = initParaConflicts(collidingPlan);
  items = setParaConflictChoice(items, "archives", "adopt");
  items = setParaConflictNewName(items, "projects", "Old Projects");

  assert.deepEqual(paraConflictResolutions(items), {
    archives: { action: "adopt", folderId: "f-archives" },
    projects: {
      action: "rename",
      folderId: "f-projects",
      newName: "Old Projects",
    },
  });
});

test("paraConflictResolutions emits skip entries", () => {
  let items = initParaConflicts(collidingPlan);
  items = setParaConflictChoice(items, "projects", "skip");
  items = setParaConflictChoice(items, "archives", "skip");
  assert.deepEqual(paraConflictResolutions(items), {
    archives: { action: "skip" },
    projects: { action: "skip" },
  });
});

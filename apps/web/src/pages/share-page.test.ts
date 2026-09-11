import assert from "node:assert/strict";
import { test } from "node:test";
import type { Note } from "@miyulabmd/shared";
import type { ApiFailure } from "../lib/api.ts";
import { filterHomeMenuItems } from "./home-page.ts";
import {
  applyShareForceLoadResult,
  shouldRemoveShareSsrPreview,
} from "./share-page.ts";

const note: Note = {
  access: {
    effectiveReadScope: "public",
    effectiveWriteScope: "self",
    flags: { canAdmin: false, canEdit: false, canView: true },
    grants: [],
    inherit: true,
    readScope: null,
    source: "default",
    sourceFolder: null,
    writeScope: null,
  },
  createdAt: 1,
  folder: "",
  folderId: null,
  id: "22222222-2222-4222-8222-222222222222",
  markdown: "# Shared",
  ownerId: "owner",
  shortId: "shr",
  title: "Shared",
  updatedAt: 1,
};

test("applyShareForceLoadResult no longer ignores errors when cache exists", () => {
  const failure: ApiFailure = {
    error: "offline",
    kind: "network",
    ok: false,
    status: 0,
  };
  const outcome = applyShareForceLoadResult({
    hadPreview: true,
    result: failure,
    routeId: note.id,
  });
  assert.equal(outcome.stale, false);
  assert.equal(outcome.phase, "offline-preview");
  assert.match(outcome.previewBanner ?? "", /オフライン/);
});

test("applyShareForceLoadResult evicts and clears on 404", () => {
  const failure: ApiFailure = {
    error: "missing",
    kind: "http",
    ok: false,
    status: 404,
  };
  const outcome = applyShareForceLoadResult({
    hadPreview: true,
    result: failure,
    routeId: note.id,
  });
  assert.deepEqual(outcome.evictIds, [note.id]);
  assert.equal(outcome.phase, "not-found");
});

test("shouldRemoveShareSsrPreview mirrors editor settled-state rule", () => {
  assert.equal(shouldRemoveShareSsrPreview("loading"), false);
  assert.equal(shouldRemoveShareSsrPreview("server-preview"), true);
});

test("filterHomeMenuItems keeps only open action when offline", () => {
  const items = filterHomeMenuItems(
    [
      { label: "開く", onSelect: () => undefined },
      { label: "共有", onSelect: () => undefined },
      { label: "削除", onSelect: () => undefined },
    ],
    true,
  );
  assert.deepEqual(
    items.map((item) => item.label),
    ["開く"],
  );
});

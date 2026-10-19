import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUserSettingsPatch } from "./settings-input.ts";

test("settings patch accepts independent lists and explicit empty-array clearing", () => {
  assert.deepEqual(
    parseUserSettingsPatch({
      folderDeletion: { protectedFolderIds: [] },
    }),
    { patch: { folderDeletion: { protectedFolderIds: [] } } },
  );
  assert.deepEqual(
    parseUserSettingsPatch({
      folderDeletion: {
        protectedPathPatterns: [" Inbox ", "Inbox", "**/.keep"],
      },
      knowledge: { para: true },
    }),
    {
      patch: {
        folderDeletion: { protectedPathPatterns: ["Inbox", "**/.keep"] },
        knowledge: { para: true },
      },
    },
  );
});

test("settings patch rejects malformed protection values instead of clearing them", () => {
  for (const invalid of [null, "Inbox", {}, ["Inbox", 1], [""], ["   "]]) {
    for (const key of ["protectedFolderIds", "protectedPathPatterns"]) {
      assert.deepEqual(
        parseUserSettingsPatch({ folderDeletion: { [key]: invalid } }),
        {
          error: `settings.folderDeletion.${key} must be an array of non-empty strings`,
        },
      );
    }
  }
});

test("settings patch rejects non-object settings and sections", () => {
  for (const value of [null, [], "invalid", false]) {
    assert.deepEqual(parseUserSettingsPatch(value), {
      error: "settings must be an object",
    });
    assert.deepEqual(parseUserSettingsPatch({ knowledge: value }), {
      error: "settings.knowledge must be an object",
    });
    assert.deepEqual(parseUserSettingsPatch({ folderDeletion: value }), {
      error: "settings.folderDeletion must be an object",
    });
  }
});

test("settings patch ignores unknown keys without persisting them", () => {
  assert.deepEqual(
    parseUserSettingsPatch({
      folderDeletion: { unknown: ["not-a-setting"] },
      future: true,
    }),
    { patch: { folderDeletion: {} } },
  );
});

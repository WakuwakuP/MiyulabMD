import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_FOLDER_DELETION_SETTINGS,
  DEFAULT_KNOWLEDGE_SETTINGS,
  DEFAULT_USER_SETTINGS,
  isKnowledgeFeatureKey,
  KNOWLEDGE_FEATURE_KEYS,
  normalizeFolderDeletionSettings,
  normalizeKnowledgeSettings,
  parseUserSettingsObject,
  userSettingsFromObject,
} from "./knowledge.ts";

test("knowledge feature keys cover para, schemes, layers (wiki-link/search excluded)", () => {
  assert.deepEqual([...KNOWLEDGE_FEATURE_KEYS].sort(), [
    "layers",
    "para",
    "schemes",
  ]);
});

test("defaults keep legacy features on and new frameworks off", () => {
  // schemes/layers are already always-on features: backward compatible ON.
  assert.equal(DEFAULT_KNOWLEDGE_SETTINGS.schemes, true);
  assert.equal(DEFAULT_KNOWLEDGE_SETTINGS.layers, true);
  // para is opt-in for new users (migrated users get true lazily).
  assert.equal(DEFAULT_KNOWLEDGE_SETTINGS.para, false);
  assert.deepEqual(DEFAULT_USER_SETTINGS.knowledge, DEFAULT_KNOWLEDGE_SETTINGS);
});

test("isKnowledgeFeatureKey whitelists known keys only", () => {
  assert.equal(isKnowledgeFeatureKey("para"), true);
  assert.equal(isKnowledgeFeatureKey("schemes"), true);
  assert.equal(isKnowledgeFeatureKey("layers"), true);
  assert.equal(isKnowledgeFeatureKey("wikilinks"), false);
  assert.equal(isKnowledgeFeatureKey("search"), false);
  assert.equal(isKnowledgeFeatureKey(42), false);
  assert.equal(isKnowledgeFeatureKey(null), false);
});

test("normalizeKnowledgeSettings fills defaults and ignores non-booleans", () => {
  assert.deepEqual(normalizeKnowledgeSettings(undefined), {
    layers: true,
    para: false,
    schemes: true,
  });
  assert.deepEqual(normalizeKnowledgeSettings({ para: true }), {
    layers: true,
    para: true,
    schemes: true,
  });
  assert.deepEqual(
    normalizeKnowledgeSettings({
      layers: "yes",
      para: 1,
      schemes: false,
      unknown: true,
    }),
    { layers: true, para: false, schemes: false },
  );
});

test("parseUserSettingsObject tolerates missing and broken JSON", () => {
  assert.deepEqual(parseUserSettingsObject(null), {});
  assert.deepEqual(parseUserSettingsObject(undefined), {});
  assert.deepEqual(parseUserSettingsObject(""), {});
  assert.deepEqual(parseUserSettingsObject("{broken"), {});
  assert.deepEqual(parseUserSettingsObject("[1,2]"), {});
  assert.deepEqual(parseUserSettingsObject('"str"'), {});
  assert.deepEqual(parseUserSettingsObject('{"knowledge":{"para":true}}'), {
    knowledge: { para: true },
  });
});

test("userSettingsFromObject normalizes the knowledge section", () => {
  assert.deepEqual(userSettingsFromObject({}), {
    folderDeletion: DEFAULT_FOLDER_DELETION_SETTINGS,
    knowledge: DEFAULT_KNOWLEDGE_SETTINGS,
  });
  assert.deepEqual(
    userSettingsFromObject({ knowledge: { para: true, schemes: false } }),
    {
      folderDeletion: DEFAULT_FOLDER_DELETION_SETTINGS,
      knowledge: { layers: true, para: true, schemes: false },
    },
  );
});

test("folder deletion settings normalize defaults and preserve configured protections", () => {
  assert.deepEqual(normalizeFolderDeletionSettings(undefined), {
    protectedFolderIds: [],
    protectedPathPatterns: [],
  });
  assert.deepEqual(
    normalizeFolderDeletionSettings({
      protectedFolderIds: [" id-1 ", "id-1", null, 42, ""],
      protectedPathPatterns: ["Inbox", "*/_keep", "**/.keep", "   "],
    }),
    {
      protectedFolderIds: ["id-1"],
      protectedPathPatterns: ["Inbox", "*/_keep", "**/.keep"],
    },
  );
  assert.deepEqual(
    normalizeFolderDeletionSettings({
      protectedFolderIds: false,
      protectedPathPatterns: "Inbox",
    }),
    DEFAULT_FOLDER_DELETION_SETTINGS,
  );
});

test("normalizing folder protections does not share mutable defaults or inputs", () => {
  const ids = ["id-1"];
  const settings = userSettingsFromObject({
    folderDeletion: { protectedFolderIds: ids },
  });
  settings.folderDeletion.protectedFolderIds.push("id-2");
  settings.folderDeletion.protectedPathPatterns.push("Inbox");
  assert.deepEqual(ids, ["id-1"]);
  assert.deepEqual(DEFAULT_FOLDER_DELETION_SETTINGS, {
    protectedFolderIds: [],
    protectedPathPatterns: [],
  });
});

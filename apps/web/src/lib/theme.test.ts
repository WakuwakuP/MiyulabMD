import assert from "node:assert/strict";
import { test } from "node:test";
import { colorSchemeFor, isThemePreference } from "./theme.ts";

test("isThemePreference accepts light, dark, black, and system", () => {
  assert.equal(isThemePreference("light"), true);
  assert.equal(isThemePreference("dark"), true);
  assert.equal(isThemePreference("black"), true);
  assert.equal(isThemePreference("system"), true);
  assert.equal(isThemePreference("auto"), false);
});

test("colorSchemeFor maps preferences to CSS color-scheme", () => {
  assert.equal(colorSchemeFor("light"), "light");
  assert.equal(colorSchemeFor("dark"), "dark");
  assert.equal(colorSchemeFor("black"), "dark");
  assert.equal(colorSchemeFor("system"), "light dark");
});

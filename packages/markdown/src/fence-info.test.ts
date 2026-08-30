import assert from "node:assert/strict";
import { test } from "node:test";
import {
  highlightLanguage,
  parseFenceInfo,
  serializeFenceInfo,
} from "./fence-info.ts";

test("parseFenceInfo splits language:filename", () => {
  assert.deepEqual(parseFenceInfo("typescript:hoge.ts"), {
    language: "typescript",
    filename: "hoge.ts",
  });
  assert.deepEqual(parseFenceInfo("typescript"), {
    language: "typescript",
    filename: "",
  });
  assert.deepEqual(parseFenceInfo(":hoge.ts"), {
    language: "",
    filename: "hoge.ts",
  });
});

test("parseFenceInfo treats unknown dotted info as a filename", () => {
  assert.deepEqual(parseFenceInfo("hoge.ts"), {
    language: "",
    filename: "hoge.ts",
  });
  assert.deepEqual(parseFenceInfo("json"), {
    language: "json",
    filename: "",
  });
});

test("highlightLanguage uses the language part, not the filename", () => {
  assert.equal(
    highlightLanguage(parseFenceInfo("typescript:hoge.ts")),
    "typescript",
  );
  assert.equal(highlightLanguage(parseFenceInfo("ts:app.tsx")), "typescript");
  assert.equal(highlightLanguage(parseFenceInfo("hoge.ts")), "typescript");
});

test("serializeFenceInfo restores language:filename", () => {
  assert.equal(
    serializeFenceInfo({ language: "typescript", filename: "hoge.ts" }),
    "typescript:hoge.ts",
  );
  assert.equal(
    serializeFenceInfo({ language: "typescript", filename: "" }),
    "typescript",
  );
  assert.equal(
    serializeFenceInfo({ language: "", filename: "hoge.ts" }),
    "hoge.ts",
  );
  assert.equal(
    serializeFenceInfo({ language: "tsx", filename: "My Component.tsx" }),
    "tsx:MyComponent.tsx",
  );
});

test("parseFenceInfo strips spaces from filenames", () => {
  assert.deepEqual(parseFenceInfo("typescript:My Component.tsx"), {
    language: "typescript",
    filename: "MyComponent.tsx",
  });
});

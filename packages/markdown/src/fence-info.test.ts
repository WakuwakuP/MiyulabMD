import assert from "node:assert/strict";
import { test } from "node:test";
import {
  highlightLanguage,
  parseFenceInfo,
  serializeFenceInfo,
} from "./fence-info.ts";

test("parseFenceInfo splits language:filename", () => {
  assert.deepEqual(parseFenceInfo("typescript:hoge.ts"), {
    filename: "hoge.ts",
    language: "typescript",
  });
  assert.deepEqual(parseFenceInfo("typescript"), {
    filename: "",
    language: "typescript",
  });
  assert.deepEqual(parseFenceInfo(":hoge.ts"), {
    filename: "hoge.ts",
    language: "",
  });
});

test("parseFenceInfo treats unknown dotted info as a filename", () => {
  assert.deepEqual(parseFenceInfo("hoge.ts"), {
    filename: "hoge.ts",
    language: "",
  });
  assert.deepEqual(parseFenceInfo("json"), {
    filename: "",
    language: "json",
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
    serializeFenceInfo({ filename: "hoge.ts", language: "typescript" }),
    "typescript:hoge.ts",
  );
  assert.equal(
    serializeFenceInfo({ filename: "", language: "typescript" }),
    "typescript",
  );
  assert.equal(
    serializeFenceInfo({ filename: "hoge.ts", language: "" }),
    "hoge.ts",
  );
  assert.equal(
    serializeFenceInfo({ filename: "My Component.tsx", language: "tsx" }),
    "tsx:MyComponent.tsx",
  );
});

test("parseFenceInfo strips spaces from filenames", () => {
  assert.deepEqual(parseFenceInfo("typescript:My Component.tsx"), {
    filename: "MyComponent.tsx",
    language: "typescript",
  });
});

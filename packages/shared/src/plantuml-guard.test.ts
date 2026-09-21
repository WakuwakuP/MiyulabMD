import assert from "node:assert/strict";
import test from "node:test";
import { validatePlantUmlSource } from "./plantuml-guard.ts";

const BLOCKED = [
  "!include https://evil.example/x.iuml",
  "!inc\\\nlude https://evil.example/x.iuml",
  "!include_local sub.puml",
  "!define INC !include https://evil.example/x\nINC",
  "!import https://evil.example/x",
  "!theme plain from https://evil.example",
  "!theme plain from //evil.example",
  '%load_json("https://evil.example/x")',
  "sprite $icon <https://evil.example/i.svg>",
  "sprite $icon https://evil.example/i.svg",
  "sprite $icon /api/internal",
  "sprite $x {\n  <svg>evil</svg>\n}",
  "<img:https://evil.example/i.png>",
  "<img https://evil.example/i.png>",
  "skinparam backgroundImage https://evil.example/i.png",
  "skinparam {\n  backgroundImage https://evil.example/i.png\n}",
  "skinparam backgroundImage /api/internal",
  "<style\nfile=https://evil.example/x.css>",
];

const ALLOWED = [
  "@startuml\nAlice -> Bob: hi\n@enduml",
  "!theme plain",
  "note right: see https://example.com/docs",
  "sprite $x [16x16/16] {\n  0000000000000000\n  00FFFFFFFFFFFF00\n}",
];

test("validatePlantUmlSource rejects external-resource vectors", () => {
  for (const source of BLOCKED) {
    assert.throws(
      () => validatePlantUmlSource(source),
      /外部リソース/,
      `should reject: ${source}`,
    );
  }
});

test("validatePlantUmlSource allows plain diagrams and URL text", () => {
  for (const source of ALLOWED) {
    validatePlantUmlSource(source);
  }
});

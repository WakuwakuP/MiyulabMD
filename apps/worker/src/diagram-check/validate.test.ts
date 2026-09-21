import assert from "node:assert/strict";
import test from "node:test";
import { validateDiagramBlocks } from "./validate.ts";

test("valid mermaid diagram passes", async () => {
  const result = await validateDiagramBlocks([
    {
      language: "mermaid",
      line: 3,
      source: "graph TD\n  A[Client] --> B[Server]",
    },
  ]);
  assert.equal(result.checked, 1);
  assert.deepEqual(result.errors, []);
});

test("invalid mermaid reports the block line", async () => {
  const result = await validateDiagramBlocks([
    {
      language: "mermaid",
      line: 10,
      source: "graph TD\n  A[Client] -->",
    },
  ]);
  assert.equal(result.checked, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].language, "mermaid");
  assert.equal(result.errors[0].line, 10);
  assert.ok(result.errors[0].error.length > 0);
});

test("valid plantuml diagram passes", async () => {
  const result = await validateDiagramBlocks([
    {
      language: "plantuml",
      line: 1,
      source: "@startuml\nAlice -> Bob: hi\n@enduml",
    },
  ]);
  assert.equal(result.checked, 1);
  assert.deepEqual(result.errors, []);
});

test("invalid plantuml is detected from the error diagram", async () => {
  const result = await validateDiagramBlocks([
    {
      language: "plantuml",
      line: 5,
      source: "@startuml\nfoo bar baz nonsense\n@enduml",
    },
  ]);
  assert.equal(result.checked, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].language, "plantuml");
  assert.equal(result.errors[0].line, 5);
});

test("plantuml external-resource directives are rejected", async () => {
  const result = await validateDiagramBlocks([
    {
      language: "plantuml",
      line: 2,
      source: "@startuml\n!include https://evil.example/x.iuml\n@enduml",
    },
  ]);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 2);
});

test("non-diagram lines still validate when a theme is used", async () => {
  const result = await validateDiagramBlocks([
    {
      language: "plantuml",
      line: 1,
      source: "@startuml\n!theme plain\nAlice -> Bob\n@enduml",
    },
  ]);
  assert.deepEqual(result.errors, []);
});

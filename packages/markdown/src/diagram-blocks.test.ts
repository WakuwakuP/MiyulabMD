import assert from "node:assert/strict";
import { test } from "node:test";
import { extractDiagramBlocks } from "./diagram-blocks.ts";

test("extractDiagramBlocks finds mermaid and plantuml fences", () => {
  const md = [
    "intro",
    "```mermaid",
    "graph TD",
    "  A-->B",
    "```",
    "middle",
    "```plantuml",
    "@startuml",
    "Alice -> Bob",
    "@enduml",
    "```",
  ].join("\n");
  const blocks = extractDiagramBlocks(md);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].language, "mermaid");
  assert.equal(blocks[0].line, 2);
  assert.equal(blocks[0].source, "graph TD\n  A-->B");
  assert.equal(blocks[1].language, "plantuml");
  assert.equal(blocks[1].line, 7);
  assert.equal(blocks[1].source, "@startuml\nAlice -> Bob\n@enduml");
});

test("extractDiagramBlocks resolves aliases and filename extensions", () => {
  const md = [
    "```mmd",
    "graph TD; A-->B",
    "```",
    "```seq.puml",
    "@startuml\nA->B\n@enduml",
    "```",
    "```plantuml:seq.puml",
    "@startuml\nA->B\n@enduml",
    "```",
    "```uml",
    "@startuml\nA->B\n@enduml",
    "```",
  ].join("\n");
  const blocks = extractDiagramBlocks(md);
  assert.deepEqual(
    blocks.map((b) => b.language),
    ["mermaid", "plantuml", "plantuml", "plantuml"],
  );
});

test("extractDiagramBlocks ignores plain code blocks", () => {
  const md = ["```ts", "const a = 1;", "```", "", "```", "no lang", "```"].join(
    "\n",
  );
  assert.equal(extractDiagramBlocks(md).length, 0);
});

test("extractDiagramBlocks does not close on a different fence char", () => {
  const md = [
    "~~~mermaid",
    "graph TD",
    "```", // backtick fence inside a tilde block stays content
    "  A-->B",
    "~~~",
    "```plantuml",
    "@startuml",
    "``", // short run is not a fence
    "@enduml",
    "```",
  ].join("\n");
  const blocks = extractDiagramBlocks(md);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].language, "mermaid");
  assert.ok(blocks[0].source.includes("```"));
  assert.equal(blocks[1].source, "@startuml\n``\n@enduml");
});

test("extractDiagramBlocks keeps an unclosed block out of the results", () => {
  const md = "```mermaid\ngraph TD\nA-->B";
  assert.equal(extractDiagramBlocks(md).length, 0);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { matchingSiteSource } from "./site-publish.ts";

const sources = [
  { id: "blog", folder: "blog" },
  { id: "tech", folder: "blog/tech" },
];

test("matchingSiteSource hides when folder is unknown", () => {
  assert.equal(matchingSiteSource(null, sources), null);
  assert.equal(matchingSiteSource(undefined, sources), null);
});

test("matchingSiteSource hides folders outside any site", () => {
  assert.equal(matchingSiteSource("", sources), null);
  assert.equal(matchingSiteSource("notes", sources), null);
  assert.equal(matchingSiteSource("blog-archive", sources), null);
});

test("matchingSiteSource picks the deepest site for a descendant", () => {
  assert.equal(matchingSiteSource("blog", sources)?.id, "blog");
  assert.equal(matchingSiteSource("blog/daily", sources)?.id, "blog");
  assert.equal(matchingSiteSource("blog/tech/2026", sources)?.id, "tech");
});

test("matchingSiteSource allows a root site only at root", () => {
  const withRoot = [...sources, { id: "root", folder: "" }];
  assert.equal(matchingSiteSource("", withRoot)?.id, "root");
  assert.equal(matchingSiteSource("blog", withRoot)?.id, "blog");
});

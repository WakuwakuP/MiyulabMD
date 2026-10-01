import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdownHtml } from "./render.ts";

test("renderMarkdownHtml renders GFM tables", () => {
  const html = renderMarkdownHtml(`| A | B |
| --- | --- |
| 1 | 2 |`);
  assert.match(html, /<table[\s>]/i);
  assert.match(html, /<th[\s>]/i);
  assert.match(html, /<td[\s>]/i);
  assert.match(html, />A</);
  assert.match(html, />1</);
});

test("renderMarkdownHtml prefixes heading ids for TOC", () => {
  const html = renderMarkdownHtml("# Hello world\n");
  assert.match(html, /id="user-content-hello-world"/);
});

test("renderMarkdownHtml is sync and does not need OGP cards", () => {
  const html = renderMarkdownHtml("https://example.com/preview-perf\n");
  assert.match(html, /example\.com\/preview-perf/);
});

test("renderMarkdownHtml highlights fenced code and shows filename", () => {
  const html = renderMarkdownHtml(
    "```typescript:hoge.ts\nconst answer = 42;\n```\n",
  );
  assert.match(html, /class="md-code-filename"/);
  assert.match(html, />hoge\.ts</);
  assert.match(html, /language-typescript/);
  assert.match(html, /hljs-/);
  assert.doesNotMatch(html, /language-typescript:hoge\.ts/);
});

test("renderMarkdownHtml skips YAML frontmatter", () => {
  const html = renderMarkdownHtml(
    "---\ntitle: Hidden\n---\n\n# Visible heading\n",
  );
  assert.match(html, /Visible heading/);
  assert.doesNotMatch(html, /Hidden/);
});

test("renderMarkdownHtml infers highlight language from a filename fence", () => {
  const html = renderMarkdownHtml("```hoge.ts\nconst answer = 42;\n```\n");
  assert.match(html, />hoge\.ts</);
  assert.match(html, /language-typescript/);
});

test("renderMarkdownHtml embeds a standalone YouTube URL", () => {
  const html = renderMarkdownHtml(
    "https://www.youtube.com/watch?v=jNQXAC9IVRw\n",
  );
  assert.match(html, /embed-youtube/);
  assert.match(html, /youtube-nocookie\.com\/embed\/jNQXAC9IVRw/);
});

test("renderMarkdownHtml keeps a YouTube start time on the embed", () => {
  const html = renderMarkdownHtml(
    "https://www.youtube.com/watch?v=jNQXAC9IVRw&t=12s\n",
  );
  assert.match(html, /embed\/jNQXAC9IVRw\?start=12/);
});

test("renderMarkdownHtml does not embed an inline YouTube URL", () => {
  const html = renderMarkdownHtml("see https://youtu.be/yI81_De3Hjk\n");
  assert.doesNotMatch(html, /embed-youtube/);
  assert.match(html, /youtu\.be\/yI81_De3Hjk/);
});

test("renderMarkdownHtml turns a mermaid fence into a diagram placeholder", () => {
  const html = renderMarkdownHtml("```mermaid\ngraph TD;\n  A-->B;\n```\n");
  assert.match(html, /class="md-diagram"/);
  assert.match(html, /data-diagram-lang="mermaid"/);
  assert.match(html, /class="md-diagram-source"/);
  assert.match(html, /A--&gt;B|A--&gt;\w*;?B|graph TD/);
});

test("renderMarkdownHtml treats puml and uml aliases as plantuml diagrams", () => {
  for (const fence of ["plantuml", "puml", "uml"]) {
    const html = renderMarkdownHtml(
      `\`\`\`${fence}\n@startuml\na -> b\n@enduml\n\`\`\`\n`,
    );
    assert.match(html, /data-diagram-lang="plantuml"/);
  }
});

test("renderMarkdownHtml infers a plantuml diagram from a filename fence", () => {
  const html = renderMarkdownHtml(
    "```flow.puml\n@startuml\na -> b\n@enduml\n```\n",
  );
  assert.match(html, /data-diagram-lang="plantuml"/);
  assert.match(html, />flow\.puml</);
});

test("renderMarkdownHtml infers diagrams from every accepted extension", () => {
  const cases: [string, string][] = [
    ["flow.mmd", "mermaid"],
    ["flow.mermaid", "mermaid"],
    ["flow.puml", "plantuml"],
    ["flow.pu", "plantuml"],
    ["flow.wsd", "plantuml"],
    ["flow.iuml", "plantuml"],
    ["flow.plantuml", "plantuml"],
  ];
  for (const [filename, lang] of cases) {
    const html = renderMarkdownHtml(`\`\`\`${filename}\nx\n\`\`\`\n`);
    assert.match(html, new RegExp(`data-diagram-lang="${lang}"`), filename);
  }
});

test("renderMarkdownHtml treats the mmd alias as a mermaid diagram", () => {
  const html = renderMarkdownHtml("```mmd\ngraph TD;\n```\n");
  assert.match(html, /data-diagram-lang="mermaid"/);
});

test("renderMarkdownHtml keeps a filename label on a diagram fence", () => {
  const html = renderMarkdownHtml("```mermaid:seq.mmd\nsequenceDiagram\n```\n");
  assert.match(html, /data-diagram-lang="mermaid"/);
  assert.match(html, /class="md-code-filename"/);
  assert.match(html, />seq\.mmd</);
});

test("renderMarkdownHtml leaves non-diagram fences as highlighted code", () => {
  const html = renderMarkdownHtml("```typescript\nconst answer = 42;\n```\n");
  assert.doesNotMatch(html, /md-diagram/);
  assert.match(html, /language-typescript/);
});

test("renderMarkdownHtml drops author iframes that are not YouTube embeds", () => {
  const html = renderMarkdownHtml(
    `<iframe src="https://evil.example/phish" allow="camera; microphone" width="100%" height="800"></iframe>\n`,
  );
  assert.doesNotMatch(html, /iframe/i);
  assert.doesNotMatch(html, /evil\.example/);
  assert.doesNotMatch(html, /camera/);
});

test("renderMarkdownHtml drops protocol-relative iframes", () => {
  const html = renderMarkdownHtml(
    `<iframe src="//evil.example/phish"></iframe>\n`,
  );
  assert.doesNotMatch(html, /iframe/i);
  assert.doesNotMatch(html, /evil\.example/);
});

test("renderMarkdownHtml keeps a privacy-enhanced YouTube embed iframe", () => {
  const html = renderMarkdownHtml(
    "https://www.youtube.com/watch?v=jNQXAC9IVRw\n",
  );
  assert.match(html, /<iframe[\s>]/);
  assert.match(html, /youtube-nocookie\.com\/embed\/jNQXAC9IVRw/);
  assert.doesNotMatch(html, /camera/);
});

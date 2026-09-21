import { expect, test } from "@playwright/test";

// Diagram engines are heavy (mermaid chunks + ~4MB PlantUML TeaVM build), so
// first-time hydration is allowed a generous budget.
test.setTimeout(120_000);

test.describe("diagram rendering", () => {
  test("hydrates mermaid and plantuml placeholders into sanitized svg", async ({
    page,
  }) => {
    await page.goto("/tests/browser/fixtures/diagrams.html");

    const mermaid = page.locator('.md-diagram[data-diagram-lang="mermaid"]');
    const plantuml = page.locator('.md-diagram[data-diagram-lang="plantuml"]');

    await expect(mermaid.first()).toHaveAttribute(
      "data-diagram-state",
      "done",
      { timeout: 60_000 },
    );
    await expect(
      mermaid.first().locator(".md-diagram-figure svg"),
    ).toBeVisible();
    // foreignObject labels must survive sanitization (node text renders).
    await expect(mermaid.first().locator(".md-diagram-figure")).toContainText(
      "Client",
    );

    await expect(plantuml).toHaveAttribute("data-diagram-state", "done", {
      timeout: 60_000,
    });
    await expect(plantuml.locator(".md-diagram-figure svg")).toBeVisible();

    // Successful renders hide the source block (decision Q2: diagram only).
    await expect(plantuml.locator(".md-diagram-source")).not.toBeVisible();
  });

  test("falls back to source with an error note on invalid mermaid", async ({
    page,
  }) => {
    await page.goto("/tests/browser/fixtures/diagrams.html");

    const broken = page
      .locator('.md-diagram[data-diagram-lang="mermaid"]')
      .nth(1);
    await expect(broken).toHaveAttribute("data-diagram-state", "error", {
      timeout: 60_000,
    });
    await expect(broken.locator(".md-diagram-error")).toContainText(
      "図の描画に失敗しました",
    );
    await expect(broken.locator(".md-diagram-source")).toBeVisible();
    await expect(broken.locator(".md-diagram-figure")).toHaveCount(0);
  });

  test("plantuml {dark:true} produces different svg (undocumented arg smoke test)", async ({
    page,
  }) => {
    await page.goto("/tests/browser/fixtures/diagrams.html");
    // First PlantUML load makes vite dev optimize @plantuml/core and triggers a
    // full reload; wait for the fixture diagram to settle before evaluating.
    await expect(
      page.locator('.md-diagram[data-diagram-lang="plantuml"]'),
    ).toHaveAttribute("data-diagram-state", "done", { timeout: 60_000 });
    await page.waitForFunction(
      () => typeof window.renderDiagramForTest === "function",
    );

    const source = "@startuml\nAlice -> Bob: ping\n@enduml";
    const [light, dark] = await page.evaluate(async (src) => {
      const render = window.renderDiagramForTest;
      if (!render) {
        throw new Error("renderDiagramForTest is not exposed");
      }
      const lightResult = await render("plantuml", src, false);
      const darkResult = await render("plantuml", src, true);
      if (!(lightResult.ok && darkResult.ok)) {
        throw new Error(
          `plantuml render failed: ${JSON.stringify({ darkResult, lightResult })}`,
        );
      }
      return [lightResult.svg, darkResult.svg];
    }, source);

    expect(light).not.toEqual(dark);
  });

  test("plantuml sources with include/import directives are rejected", async ({
    page,
  }) => {
    await page.goto("/tests/browser/fixtures/diagrams.html");
    await expect(
      page.locator('.md-diagram[data-diagram-lang="plantuml"]'),
    ).toHaveAttribute("data-diagram-state", "done", { timeout: 60_000 });

    const rejected = await page.evaluate(async () => {
      const render = window.renderDiagramForTest;
      if (!render) {
        throw new Error("renderDiagramForTest is not exposed");
      }
      const results = await Promise.all([
        render(
          "plantuml",
          "@startuml\n!include <C4/C4_Context>\nA -> B\n@enduml",
          false,
        ),
        render(
          "plantuml",
          "@startuml\n!includeurl https://example.com/x.puml\n@enduml",
          false,
        ),
        render(
          "plantuml",
          '@startuml\n!$d = %load_json("https://example.com/d.json")\n@enduml',
          false,
        ),
        render(
          "plantuml",
          "@startuml\nAlice -> Bob: <img:https://example.com/i.png>\n@enduml",
          false,
        ),
        render(
          "plantuml",
          "@startuml\nskinparam backgroundImage <https://example.com/bg.png>\nA -> B\n@enduml",
          false,
        ),
        render(
          "plantuml",
          "@startuml\n!theme spacelab from https://example.com/t.puml\nA -> B\n@enduml",
          false,
        ),
      ]);
      return results.map((result) => result.ok);
    });
    expect(rejected).toEqual([false, false, false, false, false, false]);
  });

  test("plantuml sources citing urls in plain text still render", async ({
    page,
  }) => {
    await page.goto("/tests/browser/fixtures/diagrams.html");
    const rendered = await page.evaluate(async () => {
      const render = window.renderDiagramForTest;
      if (!render) {
        throw new Error("renderDiagramForTest is not exposed");
      }
      const result = await render(
        "plantuml",
        "@startuml\nnote left: see https://example.com/docs\nAlice -> Bob\n@enduml",
        false,
      );
      return result.ok;
    });
    expect(rendered).toBe(true);
  });

  test("rich editor shows the diagram until the block is focused", async ({
    page,
  }) => {
    await page.goto("/tests/browser/fixtures/diagrams-editor.html");

    const block = page.locator('.md-code[data-language="mermaid"]');
    const figure = block.locator(".md-diagram");
    const source = block.locator("pre");

    // Unfocused: the diagram renders and the editable source stays hidden.
    await expect(figure).toHaveAttribute("data-diagram-state", "done", {
      timeout: 60_000,
    });
    await expect(figure.locator(".md-diagram-figure svg")).toBeVisible();
    await expect(source).toBeHidden();

    // Plain code blocks are untouched.
    const plain = page.locator('.md-code[data-language="typescript"]');
    await expect(plain.locator(".md-diagram")).toHaveCount(0);
    await expect(plain.locator("pre")).toBeVisible();

    // Clicking the figure focuses the block and reveals the source.
    await figure.click();
    await expect(source).toBeVisible();
    await expect(block.locator(".md-diagram")).toHaveCount(0);

    // Moving the caret out restores the rendered diagram.
    await page
      .locator(".ProseMirror p", { hasText: "plain paragraph" })
      .click();
    await expect(figure).toHaveAttribute("data-diagram-state", "done", {
      timeout: 60_000,
    });
    await expect(source).toBeHidden();
  });
});

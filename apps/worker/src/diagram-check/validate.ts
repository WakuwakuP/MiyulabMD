import { validatePlantUmlSource } from "@miyulabmd/shared";
import { installDiagramDomStub } from "./dom-stub.ts";

export type DiagramCheckBlock = {
  language: string;
  /** 1-based line number of the opening fence in the note markdown. */
  line: number;
  source: string;
};

export type DiagramCheckError = {
  error: string;
  language: string;
  line: number;
};

export type DiagramCheckResult = {
  checked: number;
  errors: DiagramCheckError[];
};

// Bound CPU cost: a note can hold many blocks and engines are heavy.
const MAX_BLOCKS = 20;
const MAX_SOURCE_LENGTH = 100_000;
const BLOCK_TIMEOUT_MS = 20_000;

let mermaidModule: Promise<typeof import("mermaid")> | null = null;
let plantumlModule: Promise<typeof import("@plantuml/core")> | null = null;

async function loadMermaid() {
  // dompurify self-initializes with window when present; without the stub it
  // resolves to the factory function and mermaid's addHook() call crashes.
  installDiagramDomStub();
  mermaidModule ??= import("mermaid");
  return (await mermaidModule).default;
}

function loadPlantUml() {
  plantumlModule ??= (async () => {
    // The stub must exist before the stdlib side-effect modules run — they
    // assign onto window/globalThis and read document/location.
    installDiagramDomStub();
    await import("@plantuml/core/viz-global.js");
    await import("@plantuml/core/themes.js");
    await import("@plantuml/core/emoji.js");
    await import("@plantuml/core/openiconic.js");
    return import("@plantuml/core");
  })();
  return plantumlModule;
}

// PlantUML reports syntax problems by rendering an error diagram instead of
// throwing — detect the markers and lift the message text out of the SVG.
const PLANTUML_ERROR_RE =
  /\[From |Syntax Error\?|Typo in the directive|An error has occurred/;

function plantUmlErrorFrom(svg: string): string | null {
  if (!PLANTUML_ERROR_RE.test(svg)) {
    return null;
  }
  const texts = [...svg.matchAll(/>([^<]{2,200})</g)]
    .map((m) => m[1] ?? "")
    .filter((t) => /error|Error|From |Typo|yntax|incorrect/.test(t))
    .map((t) => t.trim())
    .filter(Boolean);
  return texts.slice(0, 3).join(" — ") || "PlantUML reported a syntax error";
}

async function checkMermaid(source: string): Promise<void> {
  const mermaid = await loadMermaid();
  // parse() throws a real syntax error (with line info) without touching the
  // DOM — no render needed, so no error-bomb graphic is produced either.
  await mermaid.parse(source);
}

async function checkPlantUml(source: string): Promise<void> {
  validatePlantUmlSource(source);
  const plantuml = await loadPlantUml();
  const svg = await new Promise<string>((resolve, reject) => {
    plantuml.renderToString(source.split(/\r?\n/), resolve, reject, {});
  });
  const error = plantUmlErrorFrom(svg);
  if (error) {
    throw new Error(error);
  }
}

async function checkBlock(block: DiagramCheckBlock): Promise<void> {
  if (block.source.length > MAX_SOURCE_LENGTH) {
    throw new Error("diagram source is too large to check");
  }
  const run =
    block.language === "mermaid"
      ? checkMermaid(block.source)
      : checkPlantUml(block.source);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("diagram check timed out")),
          BLOCK_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function validateDiagramBlocks(
  blocks: DiagramCheckBlock[],
): Promise<DiagramCheckResult> {
  const errors: DiagramCheckError[] = [];
  const limited = blocks.slice(0, MAX_BLOCKS);
  for (const block of limited) {
    try {
      await checkBlock(block);
    } catch (error) {
      errors.push({
        error: error instanceof Error ? error.message : String(error),
        language: block.language,
        line: block.line,
      });
    }
  }
  return { checked: limited.length, errors };
}

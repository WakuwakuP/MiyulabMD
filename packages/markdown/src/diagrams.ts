import {
  type DiagramLanguage,
  diagramLanguage,
  parseFenceInfo,
} from "./fence-info.ts";

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function classList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    return value.split(/\s+/).filter(Boolean);
  }
  return [];
}

function diagramLangFromPre(node: HastNode): DiagramLanguage | null {
  const code = node.children?.find((child) => child.tagName === "code");
  if (!code) {
    return null;
  }
  const langClass = classList(code.properties?.className).find((name) =>
    name.startsWith("language-"),
  );
  return diagramLanguage(
    parseFenceInfo(langClass?.slice("language-".length) ?? ""),
  );
}

function transformDiagramNodes(nodes: HastNode[]): void {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) {
      continue;
    }
    if (node.children) {
      transformDiagramNodes(node.children);
    }
    if (node.tagName !== "pre") {
      continue;
    }
    const lang = diagramLangFromPre(node);
    if (!lang) {
      continue;
    }
    nodes[index] = {
      children: [
        {
          ...node,
          properties: { ...node.properties, className: ["md-diagram-source"] },
        },
      ],
      properties: { className: ["md-diagram"], dataDiagramLang: lang },
      tagName: "div",
      type: "element",
    };
  }
}

/**
 * Replace fenced diagram code (mermaid / plantuml) with a placeholder div.
 * The client hydrates `.md-diagram` blocks into SVG asynchronously; the
 * original source stays inside `.md-diagram-source` as SSR / error fallback.
 */
export function rehypeDiagrams() {
  return (tree: HastNode) => {
    if (tree.children) {
      transformDiagramNodes(tree.children);
    }
  };
}

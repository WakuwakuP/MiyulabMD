import {
  type FenceInfo,
  highlightLanguage,
  parseFenceInfo,
} from "./fence-info.ts";

type MdNode = {
  type: string;
  lang?: string | null;
  data?: { hProperties?: Record<string, unknown> };
  children?: MdNode[];
};

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
};

function walk<T extends { children?: T[] }>(node: T, visit: (node: T) => void) {
  visit(node);
  for (const child of node.children ?? []) {
    walk(child, visit);
  }
}

function classList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (typeof value === "string") {
    return value.split(/\s+/).filter(Boolean);
  }
  return [];
}

function fenceFromCode(code: HastNode): FenceInfo {
  const fromAttr = String(code.properties?.dataFilename ?? "").trim();
  const langClass = classList(code.properties?.className).find((name) =>
    name.startsWith("language-"),
  );
  const parsed = parseFenceInfo(langClass?.slice("language-".length) ?? "");
  return {
    filename: fromAttr || parsed.filename,
    language: parsed.language,
  };
}

export function remarkFenceInfo() {
  return (tree: MdNode) => {
    walk(tree, (node) => {
      if (node.type !== "code") {
        return;
      }
      const parsed = parseFenceInfo(node.lang ?? "");
      const language = highlightLanguage(parsed);
      node.lang = language || null;
      if (!parsed.filename) {
        return;
      }
      node.data = {
        ...node.data,
        hProperties: {
          ...node.data?.hProperties,
          dataFilename: parsed.filename,
        },
      };
    });
  };
}

export function rehypeCodeFilename() {
  return (tree: HastNode) => {
    walk(tree, (node) => {
      if (node.tagName !== "pre" || !node.children) {
        return;
      }
      const code = node.children.find((child) => child.tagName === "code");
      if (!code) {
        return;
      }

      const parsed = fenceFromCode(code);
      const language = highlightLanguage(parsed);
      const classes = classList(code.properties?.className).filter(
        (name) => !name.startsWith("language-"),
      );
      if (language) {
        classes.push(`language-${language}`);
      }
      code.properties = {
        ...code.properties,
        className: classes,
      };
      if (parsed.filename) {
        code.properties.dataFilename = parsed.filename;
      } else {
        code.properties.dataFilename = undefined;
      }
    });
  };
}

function filenameFromPre(node: HastNode): string {
  if (node.tagName !== "pre" || !node.children) {
    return "";
  }
  const code = node.children.find((child) => child.tagName === "code");
  return String(code?.properties?.dataFilename ?? "").trim();
}

function wrapPreWithFilename(node: HastNode, filename: string): HastNode {
  return {
    children: [
      {
        children: [{ type: "text", value: filename }],
        properties: { className: ["md-code-filename"] },
        tagName: "div",
        type: "element",
      },
      node,
    ],
    properties: { className: ["md-code"] },
    tagName: "div",
    type: "element",
  };
}

function wrapCodeFilenameNodes(nodes: HastNode[]) {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) {
      continue;
    }
    if (node.children) {
      wrapCodeFilenameNodes(node.children);
    }
    const filename = filenameFromPre(node);
    if (!filename) {
      continue;
    }
    nodes[index] = wrapPreWithFilename(node, filename);
  }
}

export function rehypeCodeFilenameWrap() {
  return (tree: HastNode) => {
    if (tree.children) {
      wrapCodeFilenameNodes(tree.children);
    }
  };
}

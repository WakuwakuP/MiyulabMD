// Minimal DOM surface for the TeaVM-compiled @plantuml/core engine. Layout
// fidelity does not matter for syntax checking — the engine only needs the
// calls to exist and return plausible values so it can build and serialize
// the SVG tree (or fail with a syntax error first).

type StubNode = StubElement | StubPI | string;

class StubPI {
  readonly _pi = true;
  readonly target: string;
  readonly data: string;
  constructor(target: string, data: string) {
    this.target = target;
    this.data = data;
  }
}

const CANVAS_CONTEXT = {
  font: "",
  measureText: (text: string) => ({ width: String(text).length * 8 }),
};

class StubElement {
  attributes: Record<string, string> = {};
  children: StubNode[] = [];
  style: Record<string, string> = {};
  text = "";

  readonly tagName: string;
  ownerDocument: StubDocument | null;

  constructor(tagName: string, ownerDocument: StubDocument | null) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
  }

  setAttribute(name: string, value: unknown): void {
    this.attributes[name] = String(value);
  }

  getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  appendChild<T extends StubNode>(child: T): T {
    this.children.push(child);
    if (child instanceof StubElement) {
      child.ownerDocument = this.ownerDocument;
    }
    return child;
  }

  removeChild<T extends StubNode>(child: T): T {
    this.children = this.children.filter((c) => c !== child);
    return child;
  }

  set textContent(value: string) {
    this.text = String(value);
    this.children = [];
  }

  get textContent(): string {
    if (this.children.length === 0) {
      return this.text;
    }
    return this.children.map(serializeText).join("");
  }

  getBBox() {
    return {
      height: 14,
      width: 8 * (this.textContent.length || 1),
      x: 0,
      y: 0,
    };
  }

  getComputedTextLength(): number {
    return 8 * this.textContent.length;
  }

  cloneNode(deep: boolean): StubElement {
    const copy = new StubElement(this.tagName, this.ownerDocument);
    copy.attributes = { ...this.attributes };
    copy.text = this.text;
    if (deep) {
      copy.children = this.children.map((c) =>
        c instanceof StubElement ? c.cloneNode(true) : c,
      );
    }
    return copy;
  }
}

class StubDocument {
  readonly baseURI = "https://localhost/";
  readonly currentScript = null;
  readonly nodeType = 9;
  readonly documentElement = new StubElement("html", this);
  readonly body = new StubElement("body", this);
  readonly head = new StubElement("head", this);

  createElement(tag: string):
    | StubElement
    | {
        getContext: () => typeof CANVAS_CONTEXT;
        style: Record<string, string>;
      } {
    if (tag === "canvas") {
      return { getContext: () => CANVAS_CONTEXT, style: {} };
    }
    return new StubElement(tag, this);
  }

  createElementNS(_ns: string, tag: string): StubElement {
    return new StubElement(tag, this);
  }

  createProcessingInstruction(target: string, data: string): StubPI {
    return new StubPI(target, data);
  }

  importNode<T extends StubNode>(node: T, deep: boolean): T {
    return (node instanceof StubElement ? node.cloneNode(deep) : node) as T;
  }

  getElementById(): null {
    return null;
  }

  getElementsByTagName(): [] {
    return [];
  }

  querySelectorAll(): [] {
    return [];
  }
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll('"', "&quot;");
}

function serializeText(node: StubNode): string {
  if (typeof node === "string") {
    return escapeXml(node);
  }
  if (node instanceof StubPI) {
    return `<?${node.target} ${node.data}?>`;
  }
  return serializeElement(node);
}

function serializeElement(el: StubElement): string {
  const attrs = Object.entries(el.attributes)
    .map(([k, v]) => ` ${k}="${escapeXml(v)}"`)
    .join("");
  const inner = escapeXml(el.text) + el.children.map(serializeText).join("");
  return `<${el.tagName}${attrs}>${inner}</${el.tagName}>`;
}

class StubXMLSerializer {
  serializeToString(node: StubNode): string {
    return serializeText(node);
  }
}

// The engine only uses DOMParser to embed <svg> sprite definitions. Returning
// no root element is safe — the caller checks `svgElem && tagName === "svg"`.
class StubDOMParser {
  parseFromString(): { documentElement: null } {
    return { documentElement: null };
  }
}

let installed = false;

/** Install the DOM stubs the PlantUML engine needs. Idempotent. */
export function installDiagramDomStub(): void {
  if (installed) {
    return;
  }
  installed = true;
  const g = globalThis as Record<string, unknown>;
  g.window = globalThis;
  g.document = new StubDocument();
  g.location = { href: "https://localhost/", origin: "https://localhost" };
  g.XMLSerializer = StubXMLSerializer;
  g.DOMParser = StubDOMParser;
  // mermaid registers window listeners at init; Workers expose these on
  // globalThis already, but Node (tests) does not.
  g.addEventListener ??= () => undefined;
  g.removeEventListener ??= () => undefined;
  // The browser sandbox relies on CSP connect-src 'none' to physically stop
  // the engine's egress. This worker has no CSP, so deny egress at the JS
  // surface instead — the source regex alone can be evaded by preprocessor
  // line continuations. None of the engines need the network: viz wasm is
  // base64-embedded and stdlib modules resolve via PLANTUML_STDLIB_LOADER.
  const denyEgress = (name: string) => {
    throw new Error(`network access is disabled in diagram-check (${name})`);
  };
  g.fetch = () => denyEgress("fetch");
  g.XMLHttpRequest = class {
    constructor() {
      denyEgress("XMLHttpRequest");
    }
  };
  g.WebSocket = class {
    constructor() {
      denyEgress("WebSocket");
    }
  };
  g.EventSource = class {
    constructor() {
      denyEgress("EventSource");
    }
  };
  g.importScripts = () => denyEgress("importScripts");
  // DOMPurify (loaded via mermaid) only installs addHook()/sanitize() when
  // window.document.nodeType === 9 and window.Element exist. With those, its
  // isSupported check still fails (no implementation.createHTMLDocument), so
  // sanitize() degrades to a pass-through — exactly what we want, since we
  // never insert parse output into a DOM.
  g.Element ??= StubElement;
  g.Node ??= StubElement;
  g.DocumentFragment ??= StubElement;
  g.HTMLTemplateElement ??= StubElement;
  g.HTMLFormElement ??= StubElement;
  g.NamedNodeMap ??= class {};
  g.NodeFilter ??= { SHOW_ELEMENT: 1 };
  // The engine lazy-loads stdlib modules (themes/emoji/openiconic) through
  // this hook instead of <script src>. They are pre-bundled in this worker,
  // so acknowledge the names we ship and fail everything else.
  const preloaded = new Set(["emoji.js", "openiconic.js", "themes.js"]);
  g.PLANTUML_STDLIB_LOADER = (
    name: string,
    ok: () => void,
    fail: (message: string) => void,
  ): boolean => {
    const base = name.split("/").pop() ?? name;
    if (preloaded.has(base)) {
      ok();
    } else {
      fail(`stdlib module is not bundled: ${name}`);
    }
    return true;
  };
}

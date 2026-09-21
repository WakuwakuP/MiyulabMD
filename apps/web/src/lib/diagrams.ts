import type { DiagramLanguage } from "@miyulabmd/markdown";
import plantumlPkg from "@plantuml/core/package.json";
import DOMPurify from "dompurify";
import { type RefObject, useEffect, useSyncExternalStore } from "react";
import { isDarkTheme, type ThemePreference } from "./theme.ts";

export type DiagramResult =
  | { ok: true; svg: string }
  | { ok: false; error: string };

// The PlantUML engine is fetched at runtime as a classic script into a
// sandboxed iframe — never bundled into the page's module graph. The files
// in public/diagram/plantuml/<version>/ (plantuml.js, viz-global.js, and the
// lazy siblings themes/emoji/openiconic/stdlib resolved via
// PLANTUML_STDLIB_BASE) are synced from the pinned package. Versioning the
// path keeps CacheFirst entries honest across @plantuml/core bumps.
const PLANTUML_ASSETS = `/diagram/plantuml/${plantumlPkg.version}/`;

const svgCache = new Map<string, string>();
let mermaidModule: Promise<typeof import("mermaid")> | null = null;
let plantumlSandbox: Promise<Window> | null = null;
let renderTail: Promise<void> = Promise.resolve();
let mermaidId = 0;
let insertId = 0;
let plantumlReqId = 0;

const plantumlPending = new Map<
  number,
  { resolve: (svg: string) => void; reject: (error: Error) => void }
>();

function onPlantUmlMessage(event: MessageEvent): void {
  const data = event.data;
  if (!data || typeof data.id !== "number" || typeof data.ok !== "boolean") {
    return;
  }
  const pending = plantumlPending.get(data.id);
  if (!pending) {
    return;
  }
  plantumlPending.delete(data.id);
  if (data.ok) {
    pending.resolve(String(data.svg));
  } else {
    pending.reject(new Error(String(data.error)));
  }
}

// PlantUML runs inside a sandboxed iframe (opaque origin) whose CSP forbids
// every network egress (`connect-src 'none'; img-src 'none'`). Source-level
// filtering cannot keep up with the preprocessor's expansion tricks, so the
// sandbox — not the regex — is the real confused-deputy barrier. The engine
// is an ES module; an opaque origin cannot CORS-import it, so the parent
// fetches the source and the iframe imports it from a blob: URL.
async function plantUmlSandbox(): Promise<Window> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.style.display = "none";
  iframe.setAttribute("aria-hidden", "true");
  const origin = location.origin;
  const base = `${origin}${PLANTUML_ASSETS}`;
  iframe.srcdoc = `<!doctype html><html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: ${origin}; connect-src 'none'; img-src 'none'; font-src 'none'; style-src 'unsafe-inline'">
<script src="${base}viz-global.js"></script>
</head><body><script type="module">
window.PLANTUML_STDLIB_BASE = ${JSON.stringify(base)};
window.addEventListener("message", async (e) => {
  var d = e.data;
  if (!d || d.type === undefined) return;
  if (d.type === "plantuml-load") {
    try {
      var url = URL.createObjectURL(new Blob([d.code], { type: "text/javascript" }));
      var mod = await import(url);
      URL.revokeObjectURL(url);
      window.__renderToString = mod.renderToString;
      parent.postMessage({ type: "plantuml-ready" }, "*");
    } catch (err) {
      parent.postMessage({ type: "plantuml-ready", error: String(err) }, "*");
    }
    return;
  }
  if (d.type !== "plantuml" || typeof d.id !== "number" || !window.__renderToString) return;
  try {
    window.__renderToString(
      String(d.source).split(/\\r?\\n/),
      function (svg) { parent.postMessage({ id: d.id, ok: true, svg: svg }, "*"); },
      function (err) { parent.postMessage({ id: d.id, ok: false, error: String(err) }, "*"); },
      { dark: d.dark === true }
    );
  } catch (err) {
    parent.postMessage({ id: d.id, ok: false, error: String(err) }, "*");
  }
});
parent.postMessage({ type: "plantuml-listening" }, "*");
</script></body></html>`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("PlantUML サンドボックスの初期化に失敗しました"));
    }, 30_000);
    const onMessage = async (event: MessageEvent) => {
      // contentWindow is null until the iframe is connected; compare lazily.
      const win = iframe.contentWindow;
      if (!win || event.source !== win) {
        return;
      }
      if (event.data?.type === "plantuml-listening") {
        try {
          const response = await fetch(`${PLANTUML_ASSETS}plantuml.js`);
          if (!response.ok) {
            throw new Error(`status ${response.status}`);
          }
          win.postMessage(
            { code: await response.text(), type: "plantuml-load" },
            "*",
          );
        } catch (error) {
          window.removeEventListener("message", onMessage);
          clearTimeout(timer);
          reject(
            new Error(`plantuml.js の取得に失敗: ${String(error)}`),
          );
        }
      } else if (event.data?.type === "plantuml-ready") {
        window.removeEventListener("message", onMessage);
        clearTimeout(timer);
        if (event.data.error) {
          reject(new Error(String(event.data.error)));
        } else {
          resolve(win);
        }
      }
    };
    window.addEventListener("message", onMessage);
    document.body.appendChild(iframe);
  });
}

async function renderMermaid(source: string, dark: boolean): Promise<string> {
  mermaidModule ??= import("mermaid");
  const mermaid = (await mermaidModule).default;
  mermaid.initialize({
    securityLevel: "strict",
    startOnLoad: false,
    theme: dark ? "dark" : "default",
  });
  mermaidId += 1;
  const { svg } = await mermaid.render(`md-diagram-${mermaidId}`, source);
  return svg;
}

// PlantUML features that can reach the network are rejected up front —
// shared notes would otherwise turn viewers' browsers into confused
// deputies. Blocked vectors: `!include`/`!import` directives (stdlib is
// intentionally unsupported, F2), `!theme … from <url>`, `%load_*` data
// functions, URL sprites, Creole `<img:url>` tags, and `skinparam` image
// options. Plain text that merely mentions a URL stays allowed.
const BLOCKED_PLANTUML = new RegExp(
  [
    /![^\S\r\n]*(?:include\w*|import)\b/.source, // !include/!import, incl. via !define macros
    /![^\S\r\n]*theme\b[^\n]*\bfrom\b/.source, // !theme … from <resource>
    /%load[_a-z]*\s*\(/.source, // %load_json / %load_xml / %loadYAML …
    /sprite\s+\$?\w+(?:[^\S\r\n]*\[[^\]\n]*\])?[^\S\r\n]*(?:<|\{[^{}]*<|(?:https?:)?\/)/
      .source, // sprite <res>, {…<svg>}, url/path
    /<img\b/.source, // creole images always reference a resource
    /\bbackgroundImage\b/.source, // skinparam image (any value form)
    /<\s*(?:https?:)?\/\//.source, // <https://…> / <//host> resource refs
    /^[^\S\r\n]*skinparam\b[^\n]*(?:https?:)?\/\//.source, // skinparam … url
    /skinparam\b[^\n{]*\{[^{}]*(?:https?:)?\/\//.source, // skinparam { … url }
    /<style\b[^>]*(?:file|src|href)\s*=/.source, // creole <style file=…>
  ].join("|"),
  "im",
);

function validatePlantUmlSource(source: string): void {
  if (BLOCKED_PLANTUML.test(source)) {
    throw new Error("外部リソースを取り込む PlantUML 記法には対応していません");
  }
}

async function renderPlantUml(source: string, dark: boolean): Promise<string> {
  validatePlantUmlSource(source);
  plantumlSandbox ??= plantUmlSandbox();
  // addEventListener dedupes identical listeners, so registering per call is
  // safe and keeps the handler alive for the sandbox's lifetime.
  window.addEventListener("message", onPlantUmlMessage);
  const win = await plantumlSandbox;
  return new Promise((resolve, reject) => {
    plantumlReqId += 1;
    const id = plantumlReqId;
    const timer = setTimeout(() => {
      plantumlPending.delete(id);
      reject(new Error("PlantUML の描画がタイムアウトしました"));
    }, 60_000);
    plantumlPending.set(id, {
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
      resolve: (svg) => {
        clearTimeout(timer);
        resolve(svg);
      },
    });
    // The fourth option ({dark}) is undocumented but wired in the engine
    // build; a smoke test guards it across @plantuml/core version bumps.
    win.postMessage({ dark, id, source, type: "plantuml" }, "*");
  });
}

// Mermaid labels live in <foreignObject> XHTML. DOMPurify's svg profile
// alone strips them twice over: the HTML namespace is not allowed, and
// foreignObject is not a registered HTML integration point. Enable both,
// then forbid the interactive/network-fetching HTML tags — labels only need
// formatting markup.
const FORBIDDEN_LABEL_TAGS = [
  "a",
  "img",
  "image",
  "video",
  "audio",
  "source",
  "track",
  "picture",
  "iframe",
  "object",
  "embed",
  "frame",
  "frameset",
  "portal",
  "area",
  "map",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "option",
  "details",
  "summary",
  "dialog",
  "marquee",
  "link",
  "meta",
  "base",
];

function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    ADD_TAGS: ["style", "foreignObject"],
    FORBID_TAGS: FORBIDDEN_LABEL_TAGS,
    HTML_INTEGRATION_POINTS: { foreignobject: true },
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
  });
}

// Presentational properties only — no position/z-index/animation, and url()
// is allowed solely for internal fragment references (clip-path, filter).
const ALLOWED_CSS_PROPS = new Set([
  "alignment-baseline",
  "background",
  "background-color",
  "baseline-shift",
  "clip-path",
  "clip-rule",
  "color",
  "cursor",
  "direction",
  "display",
  "dominant-baseline",
  "fill",
  "fill-opacity",
  "fill-rule",
  "filter",
  "font-family",
  "font-size",
  "font-size-adjust",
  "font-stretch",
  "font-style",
  "font-variant",
  "font-weight",
  "height",
  "letter-spacing",
  "line-height",
  "marker-end",
  "marker-mid",
  "marker-start",
  "mask",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "opacity",
  "overflow",
  "padding",
  "pointer-events",
  "stop-color",
  "stop-opacity",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "text-align",
  "text-anchor",
  "text-decoration",
  "text-transform",
  "transform",
  "transform-origin",
  "unicode-bidi",
  "vertical-align",
  "visibility",
  "white-space",
  "width",
  "word-spacing",
]);

function isSafeCssValue(value: string): boolean {
  const lowered = value.toLowerCase();
  if (
    /expression\s*\(|javascript:|-moz-binding|behavior\s*:|@import/.test(
      lowered,
    )
  ) {
    return false;
  }
  // url(...) is only safe as an internal fragment reference.
  return !/url\(\s*['"]?\s*(?!#)/i.test(lowered);
}

function sanitizeDeclarations(style: CSSStyleDeclaration): string {
  const kept: string[] = [];
  for (const prop of Array.from(style)) {
    const value = style.getPropertyValue(prop);
    if (ALLOWED_CSS_PROPS.has(prop) && value && isSafeCssValue(value)) {
      const priority = style.getPropertyPriority(prop);
      kept.push(
        `${prop}:${value}${priority === "important" ? "!important" : ""}`,
      );
    }
  }
  return kept.join(";");
}

function scopeSelector(selector: string, scope: string): string {
  return selector
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `${scope} ${part}`)
    .join(",");
}

function serializeStyleRule(rule: CSSStyleRule, scope: string): string {
  const body = sanitizeDeclarations(rule.style);
  if (!body) {
    return "";
  }
  const scoped = scopeSelector(rule.selectorText, scope);
  return scoped ? `${scoped}{${body}}` : "";
}

function serializeGroupingRule(
  rule: CSSMediaRule | CSSSupportsRule,
  scope: string,
): string {
  const inner = sanitizeStyleRules(rule.cssRules, scope);
  if (!inner) {
    return "";
  }
  const header =
    rule instanceof CSSMediaRule
      ? `@media ${rule.conditionText}`
      : `@supports ${rule.conditionText}`;
  return `${header}{${inner}}`;
}

function sanitizeStyleRules(rules: CSSRuleList, scope: string): string {
  const out: string[] = [];
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      out.push(serializeStyleRule(rule, scope));
    } else if (
      rule instanceof CSSMediaRule ||
      rule instanceof CSSSupportsRule
    ) {
      out.push(serializeGroupingRule(rule, scope));
    }
    // @import / @font-face / @keyframes / @namespace and friends are dropped:
    // they escape the figure scope or pull external resources.
  }
  return out.filter(Boolean).join("");
}

function makeRefRewriter(idPairs: [string, string][]) {
  return (value: string): string => {
    let next = value;
    for (const [oldId, newId] of idPairs) {
      next = next.split(`#${oldId}`).join(`#${newId}`);
    }
    return next;
  };
}

function rewriteElementRefs(
  content: DocumentFragment,
  idMap: Map<string, string>,
  rewriteRefs: (value: string) => string,
): void {
  for (const el of content.querySelectorAll("[id]")) {
    el.setAttribute("id", idMap.get(el.getAttribute("id") ?? "") ?? "");
  }
  for (const el of content.querySelectorAll("*")) {
    for (const attr of Array.from(el.attributes)) {
      if (!attr.value.includes("#")) {
        continue;
      }
      const next = rewriteRefs(attr.value);
      if (next !== attr.value) {
        el.setAttribute(attr.name, next);
      }
    }
  }
}

// Namespace every element id so cached SVGs cannot collide across instances
// (duplicate <marker>/<clipPath> ids would cross-reference). Returns a
// fragment-reference rewriter for attributes and <style> text.
function namespaceIds(
  content: DocumentFragment,
  uid: string,
): (value: string) => string {
  const idMap = new Map<string, string>();
  for (const el of content.querySelectorAll("[id]")) {
    const id = el.getAttribute("id");
    if (id && !idMap.has(id)) {
      idMap.set(id, `${uid}-${id}`);
    }
  }
  // Longest first so "abc" never eats the prefix of "abcd".
  const rewriteRefs = makeRefRewriter(
    [...idMap].sort((a, b) => b[0].length - a[0].length),
  );
  rewriteElementRefs(content, idMap, rewriteRefs);
  return rewriteRefs;
}

function sanitizeStyleAttribute(el: Element): void {
  if (!el.hasAttribute("style")) {
    return;
  }
  const styled = el as HTMLElement | SVGElement;
  const clean = sanitizeDeclarations(styled.style);
  if (clean) {
    el.setAttribute("style", clean);
  } else {
    el.removeAttribute("style");
  }
}

function sanitizeStyleElements(
  content: DocumentFragment,
  scope: string,
  rewriteRefs: (value: string) => string,
): void {
  for (const styleEl of content.querySelectorAll("style")) {
    const sheet = new CSSStyleSheet();
    try {
      // CSS bodies may carry url(#id) references — rename them like the
      // attributes before the rules are scoped and filtered.
      sheet.replaceSync(rewriteRefs(styleEl.textContent ?? ""));
      styleEl.textContent = sanitizeStyleRules(sheet.cssRules, scope);
    } catch {
      styleEl.remove();
    }
  }
}

/**
 * Post-process sanitized SVG for insertion: namespace element ids, confine
 * <style> rules to the figure scope, and strip dangerous CSS from style
 * elements and attributes.
 */
function prepareSvgForInsert(
  sanitized: string,
  scope: string,
  uid: string,
): string {
  const template = document.createElement("template");
  template.innerHTML = sanitized;
  const { content } = template;
  const rewriteRefs = namespaceIds(content, uid);
  for (const el of content.querySelectorAll("*")) {
    sanitizeStyleAttribute(el);
  }
  sanitizeStyleElements(content, scope, rewriteRefs);
  return template.innerHTML;
}

/** Insert a sanitized diagram SVG into a host element, scoped and namespaced. */
export function insertDiagramSvg(host: HTMLElement, svg: string): void {
  insertId += 1;
  const uid = `dg-${insertId}`;
  const scopeClass = `md-diagram-scope-${insertId}`;
  host.classList.add(scopeClass);
  host.innerHTML = prepareSvgForInsert(svg, `.${scopeClass}`, uid);
}

/**
 * Render a diagram through a shared serialized queue. Engines keep internal
 * shared state (PlantUML requires it), and yielding between jobs keeps the
 * main thread responsive while a note holds many diagrams.
 */
export function renderDiagram(
  lang: DiagramLanguage,
  source: string,
  dark: boolean,
): Promise<DiagramResult> {
  const key = `${lang}|${dark ? "d" : "l"}|${source}`;
  const cached = svgCache.get(key);
  if (cached) {
    return Promise.resolve({ ok: true, svg: cached });
  }
  const job = renderTail.then(async (): Promise<DiagramResult> => {
    await new Promise((resolve) => setTimeout(resolve));
    try {
      const svg = sanitizeSvg(
        await (lang === "mermaid"
          ? renderMermaid(source, dark)
          : renderPlantUml(source, dark)),
      );
      svgCache.set(key, svg);
      return { ok: true, svg };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
      };
    }
  });
  renderTail = job.then(
    () => undefined,
    () => undefined,
  );
  return job;
}

const systemDarkQuery = "(prefers-color-scheme: dark)";

function subscribeSystemDark(callback: () => void): () => void {
  if (typeof window.matchMedia !== "function") {
    return () => undefined;
  }
  const media = window.matchMedia(systemDarkQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function readSystemDark(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(systemDarkQuery).matches
  );
}

/** Resolve the effective dark flag, tracking the OS when theme is "system". */
export function useDiagramDark(theme: ThemePreference): boolean {
  const systemDark = useSyncExternalStore(subscribeSystemDark, readSystemDark);
  return theme === "system" ? systemDark : isDarkTheme(theme);
}

/**
 * Hydrate `.md-diagram` placeholders inside the rendered article. Diagrams
 * render only when scrolled into view; results are cached by (lang, theme,
 * source) so re-renders caused by live editing stay cheap.
 */
export function useDiagrams(
  articleRef: RefObject<HTMLElement | null>,
  html: string,
  theme: ThemePreference,
): void {
  const dark = useDiagramDark(theme);

  // biome-ignore lint/correctness/useExhaustiveDependencies: html is a rescan signal, not a closure input
  useEffect(() => {
    const root = articleRef.current;
    if (!root) {
      return;
    }
    const darkKey = dark ? "d" : "l";
    const targets = [
      ...root.querySelectorAll<HTMLElement>(".md-diagram[data-diagram-lang]"),
    ].filter((el) => el.dataset.diagramTheme !== darkKey);
    if (targets.length === 0) {
      return;
    }

    const renderElement = (el: HTMLElement) => {
      const lang = el.dataset.diagramLang as DiagramLanguage;
      const sourceEl = el.querySelector<HTMLElement>(".md-diagram-source");
      const source = sourceEl?.textContent ?? "";
      const jobTheme = darkKey;
      el.dataset.diagramTheme = darkKey;
      el.dataset.diagramState = "loading";
      el.querySelector(".md-diagram-figure")?.remove();
      el.querySelector(".md-diagram-error")?.remove();
      if (sourceEl) {
        sourceEl.style.display = "";
      }
      void renderDiagram(lang, source, dark).then((result) => {
        // Skip writes from jobs superseded by a theme change or a rescan —
        // a stale resolve must not append a second (wrong) figure.
        if (!el.isConnected || el.dataset.diagramTheme !== jobTheme) {
          return;
        }
        if (result.ok) {
          const figure = document.createElement("div");
          figure.className = "md-diagram-figure";
          insertDiagramSvg(figure, result.svg);
          if (sourceEl) {
            sourceEl.style.display = "none";
          }
          el.appendChild(figure);
          el.dataset.diagramState = "done";
        } else {
          const note = document.createElement("div");
          note.className = "md-diagram-error";
          note.textContent = `図の描画に失敗しました: ${result.error}`;
          el.prepend(note);
          el.dataset.diagramState = "error";
        }
      });
    };

    if (typeof IntersectionObserver !== "function") {
      for (const el of targets) {
        renderElement(el);
      }
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          observer.unobserve(entry.target);
          renderElement(entry.target as HTMLElement);
        }
      },
      { rootMargin: "200px" },
    );
    for (const el of targets) {
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, [articleRef, html, dark]);
}

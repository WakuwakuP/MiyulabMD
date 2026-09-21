import type { DiagramLanguage } from "@miyulabmd/markdown";
import DOMPurify from "dompurify";
import { type RefObject, useEffect, useSyncExternalStore } from "react";
import { isDarkTheme, type ThemePreference } from "./theme.ts";

export type DiagramResult =
  | { ok: true; svg: string }
  | { ok: false; error: string };

// The engine module itself is bundled via import("@plantuml/core"); the files
// in public/diagram/plantuml/ are its lazy script-tag siblings (viz-global,
// themes, emoji, openiconic, stdlib), resolved via PLANTUML_STDLIB_BASE.
type PlantUmlModule = typeof import("@plantuml/core");

declare global {
  // biome-ignore lint/style/useConsistentTypeDefinitions: declaration merging required
  interface Window {
    PLANTUML_STDLIB_BASE?: string;
  }
}

const svgCache = new Map<string, string>();
let mermaidModule: Promise<typeof import("mermaid")> | null = null;
let plantumlModule: Promise<PlantUmlModule> | null = null;
let renderTail: Promise<void> = Promise.resolve();
let mermaidId = 0;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function loadPlantUml(): Promise<PlantUmlModule> {
  plantumlModule ??= (async () => {
    window.PLANTUML_STDLIB_BASE = "/diagram/plantuml/";
    await loadScript("/diagram/plantuml/viz-global.js");
    return await import("@plantuml/core");
  })();
  return plantumlModule;
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

async function renderPlantUml(source: string, dark: boolean): Promise<string> {
  const engine = await loadPlantUml();
  return new Promise((resolve, reject) => {
    // The fourth argument ({dark}) is undocumented but wired in the engine
    // build; a smoke test guards it across @plantuml/core version bumps.
    engine.renderToString(
      source.split(/\r?\n/),
      resolve,
      (message) => reject(new Error(message)),
      { dark },
    );
  });
}

function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, {
    ADD_TAGS: ["style"],
    USE_PROFILES: { svg: true, svgFilters: true },
  });
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
      el.dataset.diagramTheme = darkKey;
      el.dataset.diagramState = "loading";
      el.querySelector(".md-diagram-figure")?.remove();
      el.querySelector(".md-diagram-error")?.remove();
      if (sourceEl) {
        sourceEl.style.display = "";
      }
      void renderDiagram(lang, source, dark).then((result) => {
        if (!el.isConnected) {
          return;
        }
        if (result.ok) {
          const figure = document.createElement("div");
          figure.className = "md-diagram-figure";
          figure.innerHTML = result.svg;
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

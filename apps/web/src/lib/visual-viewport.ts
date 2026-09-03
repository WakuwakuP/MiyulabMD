export const APP_HEIGHT_VAR = "--app-height";
export const EDITOR_SCROLL_PAD_VAR = "--editor-scroll-pad";

type ViewportLike = {
  height: number;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

type BindTarget = {
  visualViewport?: ViewportLike | null;
  innerHeight: number;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

type StyleRoot = {
  style: { setProperty(name: string, value: string): void };
};

export function editorScrollPadPx(viewportHeight: number, remPx = 16): number {
  return Math.min(8 * remPx, viewportHeight * 0.3);
}

export function readEditorScrollPadPx(
  el: { ownerDocument?: Document | null } | Element = document.documentElement,
): number {
  const root =
    el instanceof Element
      ? (el.ownerDocument?.documentElement ?? document.documentElement)
      : document.documentElement;
  const parsed = Number.parseFloat(
    getComputedStyle(root).getPropertyValue(EDITOR_SCROLL_PAD_VAR),
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 128;
}

export function syncAppHeight(
  height: number,
  remPx = 16,
  root: StyleRoot = document.documentElement,
): void {
  root.style.setProperty(APP_HEIGHT_VAR, `${height}px`);
  root.style.setProperty(
    EDITOR_SCROLL_PAD_VAR,
    `${editorScrollPadPx(height, remPx)}px`,
  );
}

/** IME で縮む visual viewport を `--app-height` に載せる。 */
export function bindVisualViewportHeight(
  target: BindTarget = window,
  root: StyleRoot = document.documentElement,
  remPx: () => number = () =>
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
    16,
): () => void {
  const sync = () => {
    const height = target.visualViewport?.height ?? target.innerHeight;
    syncAppHeight(height, remPx(), root);
  };

  const vv = target.visualViewport;
  vv?.addEventListener("resize", sync);
  vv?.addEventListener("scroll", sync);
  target.addEventListener("orientationchange", sync);
  sync();

  return () => {
    vv?.removeEventListener("resize", sync);
    vv?.removeEventListener("scroll", sync);
    target.removeEventListener("orientationchange", sync);
  };
}

export const APP_HEIGHT_VAR = "--app-height";
export const APP_OFFSET_TOP_VAR = "--app-offset-top";
export const EDITOR_SCROLL_PAD_VAR = "--editor-scroll-pad";

type ViewportLike = {
  height: number;
  offsetTop: number;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

type BindTarget = {
  visualViewport?: ViewportLike | null;
  innerHeight: number;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

type StyleRoot = {
  style: { setProperty(name: string, value: string): void };
};

export function editorScrollPadPx(viewportHeight: number, remPx = 16): number {
  return Math.min(8 * remPx, viewportHeight * 0.3);
}

/** キャレットが可視領域の端に張り付かないよう、必要な scrollTop 差分を返す。 */
export function scrollDeltaForPaddedRect(
  scrollerTop: number,
  scrollerBottom: number,
  rectTop: number,
  rectBottom: number,
  pad: number,
): number {
  const height = scrollerBottom - scrollerTop;
  const inset = Math.min(
    pad,
    Math.max(0, (height - (rectBottom - rectTop)) / 2),
  );
  const topLimit = scrollerTop + inset;
  const bottomLimit = scrollerBottom - inset;
  if (rectTop < topLimit) {
    return rectTop - topLimit;
  }
  if (rectBottom > bottomLimit) {
    return rectBottom - bottomLimit;
  }
  return 0;
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
  offsetTop = 0,
): void {
  root.style.setProperty(APP_HEIGHT_VAR, `${height}px`);
  root.style.setProperty(APP_OFFSET_TOP_VAR, `${offsetTop}px`);
  root.style.setProperty(
    EDITOR_SCROLL_PAD_VAR,
    `${editorScrollPadPx(height, remPx)}px`,
  );
}

/** IME で縮む visual viewport を `--app-height` / `--app-offset-top` に載せる。 */
export function bindVisualViewportHeight(
  target: BindTarget = window,
  root: StyleRoot = document.documentElement,
  remPx: () => number = () =>
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
    16,
): () => void {
  let raf = 0;
  const requestFrame =
    target.requestAnimationFrame?.bind(target) ??
    globalThis.requestAnimationFrame?.bind(globalThis);
  const cancelFrame =
    target.cancelAnimationFrame?.bind(target) ??
    globalThis.cancelAnimationFrame?.bind(globalThis);

  const sync = () => {
    const vv = target.visualViewport;
    const height = vv?.height ?? target.innerHeight;
    const offsetTop = vv?.offsetTop ?? 0;
    syncAppHeight(height, remPx(), root, offsetTop);
  };

  const schedule = () => {
    if (raf) return;
    if (!requestFrame) {
      sync();
      return;
    }
    raf = requestFrame(() => {
      raf = 0;
      sync();
    });
  };

  const vv = target.visualViewport;
  vv?.addEventListener("resize", schedule);
  vv?.addEventListener("scroll", schedule);
  target.addEventListener("orientationchange", schedule);
  sync();

  return () => {
    if (raf && cancelFrame) cancelFrame(raf);
    raf = 0;
    vv?.removeEventListener("resize", schedule);
    vv?.removeEventListener("scroll", schedule);
    target.removeEventListener("orientationchange", schedule);
  };
}

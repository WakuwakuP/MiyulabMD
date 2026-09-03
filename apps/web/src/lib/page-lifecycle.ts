export type PageLifecycleHandlers = {
  leave: () => void;
  reconnect: () => void;
};

export type SessionLifecycle = {
  leave: () => void;
  reconnect: () => void;
  destroy: () => void;
};

export type PageLifecycleSupport = {
  /** `freeze` / `resume`（Chromium 系のみ） */
  freeze: boolean;
  /**
   * `pagehide` が来ない離脱（iOS のタブ/アプリ閉じなど）向け。
   * `visibilitychange` → hidden を切断に使う。
   */
  hiddenFallback: boolean;
};

type ListenerOptions = { capture?: boolean };

type LifecycleTarget = {
  addEventListener(
    type: string,
    listener: EventListener,
    options?: ListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListener,
    options?: ListenerOptions,
  ): void;
};

type LifecycleDocument = LifecycleTarget & {
  visibilityState?: string;
};

export type BindPageLifecycleOptions = {
  window?: LifecycleTarget;
  document?: LifecycleDocument;
  support?: PageLifecycleSupport;
};

const CAPTURE = { capture: true } as const;

function hasEventHandler(target: object | undefined, name: string): boolean {
  return Boolean(target && name in target);
}

function matchMediaMatches(win: object, query: string): boolean {
  const matchMedia = (win as { matchMedia?: (q: string) => { matches?: boolean } })
    .matchMedia;
  return Boolean(matchMedia?.(query)?.matches);
}

/**
 * pagehide が特に欠ける環境: 粗いポインタ（モバイル）と iOS / iPadOS WebKit。
 */
function needsHiddenFallback(win: object): boolean {
  if (matchMediaMatches(win, "(hover: none) and (pointer: coarse)")) {
    return true;
  }
  const css = (win as { CSS?: { supports?: (p: string, v: string) => boolean } })
    .CSS;
  if (css?.supports?.("-webkit-touch-callout", "none")) {
    return true;
  }
  const nav = (
    win as { navigator?: { maxTouchPoints?: number; platform?: string } }
  ).navigator;
  return nav?.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1;
}

export function detectPageLifecycleSupport(
  win: object = globalThis,
  doc: object | undefined = (globalThis as { document?: object }).document,
): PageLifecycleSupport {
  const freeze = hasEventHandler(doc, "onfreeze");
  return {
    freeze,
    hiddenFallback: !freeze && needsHiddenFallback(win),
  };
}

function visibilityStateOf(doc: LifecycleDocument | undefined): string | undefined {
  if (!doc || typeof doc.visibilityState !== "string") {
    return undefined;
  }
  return doc.visibilityState;
}

/**
 * 切断は Page Lifecycle に載せる。イベントは capture で取る（バブリングしないため）。
 *
 * - Chromium: `pagehide` + `freeze`。`visibilitychange` はタブ切替でも出るので使わない。
 * - Firefox / macOS Safari: `freeze` なし。`pagehide` で離脱する。
 * - iOS / モバイルかつ `freeze` なし: `pagehide` が来ないことがあるので
 *   hidden を最後の確実な離脱にする。
 */
export function bindPageLifecycle(
  handlers: PageLifecycleHandlers,
  targets: BindPageLifecycleOptions = {},
): () => void {
  const win = targets.window ?? globalThis;
  const doc =
    targets.document ??
    (globalThis as { document?: LifecycleDocument }).document;
  const support = targets.support ?? detectPageLifecycleSupport(win, doc);

  const onPageHide = () => {
    handlers.leave();
  };
  const onFreeze = () => {
    handlers.leave();
  };
  const onPageShow = (event: Event) => {
    if ("persisted" in event && event.persisted) {
      handlers.reconnect();
    }
  };
  const onResume = () => {
    handlers.reconnect();
  };
  const onVisibilityChange = () => {
    if (visibilityStateOf(doc) === "hidden") {
      handlers.leave();
      return;
    }
    if (visibilityStateOf(doc) === "visible") {
      handlers.reconnect();
    }
  };

  const unbind: Array<() => void> = [];

  const listen = (
    target: LifecycleTarget | undefined,
    type: string,
    listener: EventListener,
  ) => {
    if (!target) {
      return;
    }
    target.addEventListener(type, listener, CAPTURE);
    unbind.push(() => {
      target.removeEventListener(type, listener, CAPTURE);
    });
  };

  listen(win, "pagehide", onPageHide);
  listen(win, "pageshow", onPageShow);

  if (support.freeze) {
    listen(doc, "freeze", onFreeze);
    listen(doc, "resume", onResume);
  } else if (support.hiddenFallback) {
    listen(doc, "visibilitychange", onVisibilityChange);
  }

  return () => {
    for (const remove of unbind) {
      remove();
    }
  };
}

export function createSessionLifecycle(options: {
  leave: () => void;
  reconnect: () => void;
  dispose: () => void;
  bind?: (handlers: PageLifecycleHandlers) => () => void;
}): SessionLifecycle {
  let destroyed = false;
  let left = false;
  let unbind = () => {};

  const api: SessionLifecycle = {
    leave() {
      if (destroyed || left) {
        return;
      }
      left = true;
      options.leave();
    },
    reconnect() {
      if (destroyed || !left) {
        return;
      }
      left = false;
      options.reconnect();
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      unbind();
      if (!left) {
        options.leave();
      }
      left = true;
      options.dispose();
    },
  };

  unbind = (options.bind ?? bindPageLifecycle)({
    leave: () => {
      api.leave();
    },
    reconnect: () => {
      api.reconnect();
    },
  });

  return api;
}

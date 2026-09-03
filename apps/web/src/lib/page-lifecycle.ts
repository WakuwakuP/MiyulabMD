export type PageLifecycleHandlers = {
  leave: () => void;
  reconnect: () => void;
};

export type SessionLifecycle = {
  leave: () => void;
  reconnect: () => void;
  destroy: () => void;
};

type LifecycleTarget = {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

/**
 * 切断は Page Lifecycle に載せる。
 * `visibilitychange` はタブ切替で発火するので使わない。
 */
export function bindPageLifecycle(
  handlers: PageLifecycleHandlers,
  targets: { window?: LifecycleTarget; document?: LifecycleTarget } = {},
): () => void {
  const win = targets.window ?? globalThis;
  const doc = targets.document ?? globalThis.document;

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

  win.addEventListener("pagehide", onPageHide);
  win.addEventListener("pageshow", onPageShow);
  doc.addEventListener("freeze", onFreeze);
  doc.addEventListener("resume", onResume);

  return () => {
    win.removeEventListener("pagehide", onPageHide);
    win.removeEventListener("pageshow", onPageShow);
    doc.removeEventListener("freeze", onFreeze);
    doc.removeEventListener("resume", onResume);
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

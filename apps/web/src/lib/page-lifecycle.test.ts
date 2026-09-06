import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bindPageLifecycle,
  createSessionLifecycle,
  detectPageLifecycleSupport,
} from "./page-lifecycle.ts";

type FakeTarget = {
  visibilityState?: string;
  listeners: Map<string, Set<EventListener>>;
  addEventListener(
    type: string,
    listener: EventListener,
    _options?: { capture?: boolean },
  ): void;
  removeEventListener(
    type: string,
    listener: EventListener,
    _options?: { capture?: boolean },
  ): void;
  dispatch(type: string, event?: Event): void;
};

function fakeTarget(extra: Record<string, unknown> = {}): FakeTarget {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    dispatch(type, event = new Event(type)) {
      for (const listener of listeners.get(type) ?? []) {
        listener.call(undefined, event);
      }
    },
    listeners,
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    ...extra,
  };
}

function persistedPageShow(): Event {
  const event = new Event("pageshow") as Event & { persisted: boolean };
  Object.defineProperty(event, "persisted", { value: true });
  return event;
}

test("detectPageLifecycleSupport: Chromium has freeze and no hidden fallback", () => {
  const support = detectPageLifecycleSupport(
    { matchMedia: () => ({ matches: false }) },
    { onfreeze: null },
  );
  assert.deepEqual(support, { freeze: true, hiddenFallback: false });
});

test("detectPageLifecycleSupport: Firefox desktop has neither freeze nor hidden fallback", () => {
  const support = detectPageLifecycleSupport(
    { matchMedia: () => ({ matches: false }) },
    {},
  );
  assert.deepEqual(support, { freeze: false, hiddenFallback: false });
});

test("detectPageLifecycleSupport: mobile without freeze uses hidden fallback", () => {
  const support = detectPageLifecycleSupport(
    {
      matchMedia: (query: string) => ({
        matches: query.includes("pointer: coarse"),
      }),
    },
    {},
  );
  assert.deepEqual(support, { freeze: false, hiddenFallback: true });
});

test("detectPageLifecycleSupport: iOS WebKit without freeze uses hidden fallback", () => {
  const support = detectPageLifecycleSupport(
    {
      CSS: { supports: (prop: string) => prop === "-webkit-touch-callout" },
      matchMedia: () => ({ matches: false }),
    },
    {},
  );
  assert.deepEqual(support, { freeze: false, hiddenFallback: true });
});

test("detectPageLifecycleSupport: iPadOS desktop UA without freeze uses hidden fallback", () => {
  const support = detectPageLifecycleSupport(
    {
      matchMedia: () => ({ matches: false }),
      navigator: { maxTouchPoints: 5, platform: "MacIntel" },
    },
    {},
  );
  assert.deepEqual(support, { freeze: false, hiddenFallback: true });
});

test("Chromium: pagehide and freeze call leave, visibilitychange does not", () => {
  const win = fakeTarget();
  const doc = fakeTarget({ visibilityState: "visible" });
  let leaves = 0;
  let reconnects = 0;

  const unbind = bindPageLifecycle(
    {
      leave: () => {
        leaves += 1;
      },
      reconnect: () => {
        reconnects += 1;
      },
    },
    {
      document: doc,
      support: { freeze: true, hiddenFallback: false },
      window: win,
    },
  );

  doc.visibilityState = "hidden";
  win.dispatch("visibilitychange");
  doc.dispatch("visibilitychange");
  assert.equal(leaves, 0);

  win.dispatch("pagehide");
  assert.equal(leaves, 1);

  doc.dispatch("freeze");
  assert.equal(leaves, 2);
  assert.equal(reconnects, 0);

  unbind();
  win.dispatch("pagehide");
  doc.dispatch("freeze");
  assert.equal(leaves, 2);
});

test("Chromium: pageshow persisted and resume call reconnect", () => {
  const win = fakeTarget();
  const doc = fakeTarget();
  let reconnects = 0;

  bindPageLifecycle(
    {
      leave: () => undefined,
      reconnect: () => {
        reconnects += 1;
      },
    },
    {
      document: doc,
      support: { freeze: true, hiddenFallback: false },
      window: win,
    },
  );

  win.dispatch("pageshow", new Event("pageshow"));
  assert.equal(reconnects, 0);

  win.dispatch("pageshow", persistedPageShow());
  assert.equal(reconnects, 1);

  doc.dispatch("resume");
  assert.equal(reconnects, 2);
});

test("Firefox desktop: pagehide leaves, visibilitychange and freeze do not", () => {
  const win = fakeTarget();
  const doc = fakeTarget({ visibilityState: "visible" });
  let leaves = 0;
  let reconnects = 0;

  bindPageLifecycle(
    {
      leave: () => {
        leaves += 1;
      },
      reconnect: () => {
        reconnects += 1;
      },
    },
    {
      document: doc,
      support: { freeze: false, hiddenFallback: false },
      window: win,
    },
  );

  doc.visibilityState = "hidden";
  doc.dispatch("visibilitychange");
  doc.dispatch("freeze");
  assert.equal(leaves, 0);

  win.dispatch("pagehide");
  assert.equal(leaves, 1);

  win.dispatch("pageshow", persistedPageShow());
  assert.equal(reconnects, 1);

  doc.dispatch("resume");
  assert.equal(reconnects, 1);
});

test("iOS / mobile: hidden leaves and visible reconnects, freeze does not", () => {
  const win = fakeTarget();
  const doc = fakeTarget({ visibilityState: "visible" });
  let leaves = 0;
  let reconnects = 0;

  bindPageLifecycle(
    {
      leave: () => {
        leaves += 1;
      },
      reconnect: () => {
        reconnects += 1;
      },
    },
    {
      document: doc,
      support: { freeze: false, hiddenFallback: true },
      window: win,
    },
  );

  doc.dispatch("freeze");
  assert.equal(leaves, 0);

  doc.visibilityState = "hidden";
  doc.dispatch("visibilitychange");
  assert.equal(leaves, 1);

  doc.visibilityState = "visible";
  doc.dispatch("visibilitychange");
  assert.equal(reconnects, 1);

  win.dispatch("pagehide");
  assert.equal(leaves, 2);

  win.dispatch("pageshow", persistedPageShow());
  assert.equal(reconnects, 2);
});

test("leave and destroy are idempotent", () => {
  let leaves = 0;
  let reconnects = 0;
  let disposes = 0;

  const lifecycle = createSessionLifecycle({
    bind: () => () => undefined,
    dispose: () => {
      disposes += 1;
    },
    leave: () => {
      leaves += 1;
    },
    reconnect: () => {
      reconnects += 1;
    },
  });

  lifecycle.leave();
  lifecycle.leave();
  assert.equal(leaves, 1);

  lifecycle.reconnect();
  lifecycle.reconnect();
  assert.equal(reconnects, 1);

  lifecycle.destroy();
  lifecycle.destroy();
  lifecycle.leave();
  lifecycle.reconnect();
  assert.equal(leaves, 2);
  assert.equal(reconnects, 1);
  assert.equal(disposes, 1);
});

test("destroy leaves once when still connected", () => {
  let leaves = 0;
  let disposes = 0;

  const lifecycle = createSessionLifecycle({
    bind: () => () => undefined,
    dispose: () => {
      disposes += 1;
    },
    leave: () => {
      leaves += 1;
    },
    reconnect: () => undefined,
  });

  lifecycle.destroy();
  assert.equal(leaves, 1);
  assert.equal(disposes, 1);
});

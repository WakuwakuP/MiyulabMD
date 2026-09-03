import assert from "node:assert/strict";
import { test } from "node:test";
import { bindPageLifecycle, createSessionLifecycle } from "./page-lifecycle.ts";

type FakeTarget = {
  listeners: Map<string, Set<EventListener>>;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  dispatch(type: string, event?: Event): void;
};

function fakeTarget(): FakeTarget {
  const listeners = new Map<string, Set<EventListener>>();
  return {
    listeners,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type, event = new Event(type)) {
      for (const listener of listeners.get(type) ?? []) {
        listener.call(undefined, event);
      }
    },
  };
}

test("pagehide and freeze call leave, visibilitychange does not", () => {
  const win = fakeTarget();
  const doc = fakeTarget();
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
    { window: win, document: doc },
  );

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
  assert.equal(leaves, 2);
});

test("pageshow persisted and resume call reconnect", () => {
  const win = fakeTarget();
  const doc = fakeTarget();
  let reconnects = 0;

  bindPageLifecycle(
    {
      leave: () => {},
      reconnect: () => {
        reconnects += 1;
      },
    },
    { window: win, document: doc },
  );

  win.dispatch("pageshow", new Event("pageshow"));
  assert.equal(reconnects, 0);

  const persisted = new Event("pageshow") as Event & { persisted: boolean };
  Object.defineProperty(persisted, "persisted", { value: true });
  win.dispatch("pageshow", persisted);
  assert.equal(reconnects, 1);

  doc.dispatch("resume");
  assert.equal(reconnects, 2);
});

test("leave and destroy are idempotent", () => {
  let leaves = 0;
  let reconnects = 0;
  let disposes = 0;

  const lifecycle = createSessionLifecycle({
    leave: () => {
      leaves += 1;
    },
    reconnect: () => {
      reconnects += 1;
    },
    dispose: () => {
      disposes += 1;
    },
    bind: () => () => {},
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
    leave: () => {
      leaves += 1;
    },
    reconnect: () => {},
    dispose: () => {
      disposes += 1;
    },
    bind: () => () => {},
  });

  lifecycle.destroy();
  assert.equal(leaves, 1);
  assert.equal(disposes, 1);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APP_HEIGHT_VAR,
  bindVisualViewportHeight,
  EDITOR_SCROLL_PAD_VAR,
  editorScrollPadPx,
  scrollDeltaForPaddedRect,
  syncAppHeight,
} from "./visual-viewport.ts";

test("scrollDeltaForPaddedRect keeps the caret away from the scroller edge", () => {
  assert.equal(scrollDeltaForPaddedRect(0, 400, 350, 370, 80), 50);
  assert.equal(scrollDeltaForPaddedRect(0, 400, 10, 30, 80), -70);
  assert.equal(scrollDeltaForPaddedRect(0, 400, 160, 180, 80), 0);
});

test("editorScrollPadPx caps at 8rem and 30% of the viewport", () => {
  assert.equal(editorScrollPadPx(1000, 16), 128);
  assert.equal(editorScrollPadPx(200, 16), 60);
});

test("syncAppHeight writes viewport height and scroll pad", () => {
  const props: Record<string, string> = {};
  syncAppHeight(200, 16, {
    style: {
      setProperty(name, value) {
        props[name] = value;
      },
    },
  });
  assert.equal(props[APP_HEIGHT_VAR], "200px");
  assert.equal(props[EDITOR_SCROLL_PAD_VAR], "60px");
});

test("bindVisualViewportHeight updates on resize and scroll, then unbinds", () => {
  const listeners = new Map<string, Set<EventListener>>();
  const vvListeners = new Map<string, Set<EventListener>>();
  const props: Record<string, string> = {};
  let height = 800;

  const target = {
    innerHeight: 900,
    visualViewport: {
      get height() {
        return height;
      },
      addEventListener(type: string, listener: EventListener) {
        const set = vvListeners.get(type) ?? new Set();
        set.add(listener);
        vvListeners.set(type, set);
      },
      removeEventListener(type: string, listener: EventListener) {
        vvListeners.get(type)?.delete(listener);
      },
    },
    addEventListener(type: string, listener: EventListener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: EventListener) {
      listeners.get(type)?.delete(listener);
    },
  };

  const unbind = bindVisualViewportHeight(
    target,
    {
      style: {
        setProperty(name, value) {
          props[name] = value;
        },
      },
    },
    () => 16,
  );

  assert.equal(props[APP_HEIGHT_VAR], "800px");
  assert.equal(props[EDITOR_SCROLL_PAD_VAR], "128px");

  height = 400;
  for (const listener of vvListeners.get("resize") ?? []) {
    listener.call(undefined, new Event("resize"));
  }
  assert.equal(props[APP_HEIGHT_VAR], "400px");
  assert.equal(props[EDITOR_SCROLL_PAD_VAR], "120px");

  height = 300;
  for (const listener of vvListeners.get("scroll") ?? []) {
    listener.call(undefined, new Event("scroll"));
  }
  assert.equal(props[APP_HEIGHT_VAR], "300px");

  unbind();
  height = 100;
  for (const listener of vvListeners.get("resize") ?? []) {
    listener.call(undefined, new Event("resize"));
  }
  assert.equal(props[APP_HEIGHT_VAR], "300px");
  assert.equal(vvListeners.get("resize")?.size ?? 0, 0);
  assert.equal(listeners.get("orientationchange")?.size ?? 0, 0);
});

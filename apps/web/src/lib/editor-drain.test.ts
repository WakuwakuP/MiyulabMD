import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  getEditorDrain,
  registerEditorDrain,
  resetEditorDrainsForTests,
  unregisterEditorDrain,
} from "./editor-drain.ts";
import type { EditorDrain } from "./offline-types.ts";
import { createRichEditorDrain, drainRichSync } from "./rich-editor-drain.ts";
import {
  createSourceEditorDrain,
  drainSourceSync,
  readSourceDraft,
} from "./source-editor-drain.ts";

function stubDrain(label: string): EditorDrain {
  return {
    awaitIdle: async () => undefined,
    drainSync: () => ({ pendingComposition: false }),
    readDraft: () => label,
  };
}

afterEach(() => {
  resetEditorDrainsForTests();
});

test("registerEditorDrain replaces the drain for the same key", () => {
  const first = stubDrain("first");
  const second = stubDrain("second");
  registerEditorDrain("note-1", first);
  registerEditorDrain("note-1", second);
  assert.equal(getEditorDrain("note-1")?.readDraft(), "second");
});

test("unregisterEditorDrain removes only the same drain object", () => {
  const first = stubDrain("first");
  const second = stubDrain("second");
  registerEditorDrain("note-1", first);
  registerEditorDrain("note-1", second);
  unregisterEditorDrain("note-1", first);
  assert.equal(getEditorDrain("note-1")?.readDraft(), "second");
  unregisterEditorDrain("note-1", second);
  assert.equal(getEditorDrain("note-1"), null);
});

test("source drain reads the latest doc and reports composition", () => {
  const refs = {
    composing: { current: true },
    getView: () =>
      ({
        state: { doc: { toString: () => "# hello" } },
      }) as never,
  };
  const drain = createSourceEditorDrain(refs);
  assert.equal(readSourceDraft(refs), "# hello");
  assert.deepEqual(drainSourceSync(refs), { pendingComposition: true });
  refs.composing.current = false;
  assert.deepEqual(drain.drainSync(), { pendingComposition: false });
});

test("rich drain waits on composition and pending remote", () => {
  let composing = true;
  let pendingRemote = false;
  let flushed = false;
  const drain = createRichEditorDrain({
    flushIfReady: () => {
      flushed = true;
    },
    isComposing: () => composing,
    isPendingRemote: () => pendingRemote,
    readDraft: () => "body",
  });
  assert.deepEqual(
    drainRichSync({
      flushIfReady: () => {
        flushed = true;
      },
      isComposing: () => composing,
      isPendingRemote: () => pendingRemote,
      readDraft: () => "body",
    }),
    { pendingComposition: true },
  );
  composing = false;
  pendingRemote = true;
  assert.deepEqual(drain.drainSync(), { pendingComposition: true });
  assert.equal(flushed, false);
  pendingRemote = false;
  assert.deepEqual(drain.drainSync(), { pendingComposition: false });
  assert.equal(flushed, true);
  assert.equal(drain.readDraft(), "body");
});

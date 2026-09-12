import type { EditorView } from "@codemirror/view";
import type { EditorDrain } from "./offline-types.ts";

export const COMPOSITION_IDLE_TIMEOUT_MS = 3000;
export const COMPOSITION_IDLE_POLL_MS = 16;

export type SourceEditorDrainRefs = {
  composing: { current: boolean };
  getView: () => EditorView | null;
};

export function readSourceDraft(refs: SourceEditorDrainRefs): string {
  return refs.getView()?.state.doc.toString() ?? "";
}

export function drainSourceSync(refs: SourceEditorDrainRefs): {
  pendingComposition: boolean;
} {
  return { pendingComposition: refs.composing.current };
}

export function waitForCondition(
  condition: () => boolean,
  timeoutMs = COMPOSITION_IDLE_TIMEOUT_MS,
  pollMs = COMPOSITION_IDLE_POLL_MS,
): Promise<void> {
  if (condition()) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (condition() || Date.now() - started >= timeoutMs) {
        resolve();
        return;
      }
      setTimeout(tick, pollMs);
    };
    tick();
  });
}

export async function awaitSourceIdle(
  refs: SourceEditorDrainRefs,
  timeoutMs = COMPOSITION_IDLE_TIMEOUT_MS,
): Promise<void> {
  await waitForCondition(() => !refs.composing.current, timeoutMs);
}

export function createSourceEditorDrain(
  refs: SourceEditorDrainRefs,
): EditorDrain {
  return {
    awaitIdle: () => awaitSourceIdle(refs),
    drainSync: () => drainSourceSync(refs),
    readDraft: () => readSourceDraft(refs),
  };
}

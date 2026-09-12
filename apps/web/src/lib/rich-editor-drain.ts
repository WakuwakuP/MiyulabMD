import type { EditorDrain } from "./offline-types.ts";
import {
  COMPOSITION_IDLE_POLL_MS,
  COMPOSITION_IDLE_TIMEOUT_MS,
  waitForCondition,
} from "./source-editor-drain.ts";

export type RichEditorDrainHooks = {
  readDraft: () => string;
  isComposing: () => boolean;
  isPendingRemote: () => boolean;
  flushIfReady: () => void;
};

export function drainRichSync(hooks: RichEditorDrainHooks): {
  pendingComposition: boolean;
} {
  if (hooks.isComposing() || hooks.isPendingRemote()) {
    return { pendingComposition: true };
  }
  hooks.flushIfReady();
  return { pendingComposition: false };
}

export async function awaitRichIdle(
  hooks: Pick<RichEditorDrainHooks, "isComposing" | "isPendingRemote">,
  timeoutMs = COMPOSITION_IDLE_TIMEOUT_MS,
): Promise<void> {
  await waitForCondition(
    () => !(hooks.isComposing() || hooks.isPendingRemote()),
    timeoutMs,
    COMPOSITION_IDLE_POLL_MS,
  );
}

export function createRichEditorDrain(
  hooks: RichEditorDrainHooks,
): EditorDrain {
  return {
    awaitIdle: () => awaitRichIdle(hooks),
    drainSync: () => drainRichSync(hooks),
    readDraft: hooks.readDraft,
  };
}

import type { EditorDrain } from "./offline-types.ts";

const drains = new Map<string, EditorDrain>();

export function registerEditorDrain(key: string, drain: EditorDrain): void {
  drains.set(key, drain);
}

export function unregisterEditorDrain(key: string, drain: EditorDrain): void {
  if (drains.get(key) === drain) {
    drains.delete(key);
  }
}

export function getEditorDrain(key: string): EditorDrain | null {
  return drains.get(key) ?? null;
}

/** Test-only reset. */
export function resetEditorDrainsForTests(): void {
  drains.clear();
}

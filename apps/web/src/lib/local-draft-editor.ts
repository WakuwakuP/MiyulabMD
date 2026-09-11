import * as Y from "yjs";
import {
  applyAwarenessUser,
  createOfflineAwareness,
  type CollabAwareness,
} from "./collaboration.ts";
import type { DraftLockHandle } from "./draft-lock.ts";
import {
  awaitDraftCommitted,
  type LocalDraft,
  type LocalDraftId,
  saveDraft,
} from "./draft-store.ts";
import { getEditorDrain } from "./editor-drain.ts";
import type { SessionEpoch } from "./offline-types.ts";

const MARKDOWN_FIELD = "markdown";

export type LocalDraftEditor = {
  doc: Y.Doc;
  yMarkdown: Y.Text;
  awareness: CollabAwareness;
  draft: LocalDraft;
  lock: DraftLockHandle | null;
  readonly: boolean;
  saveState: "idle" | "saving" | "error" | "conflict";
  saveError: string | null;
  flush(): Promise<void>;
  queueSave(): void;
  destroy(): void;
};

type EditorEntry = {
  editor: LocalDraftEditor;
  saveChain: Promise<void>;
  pendingSave: boolean;
  nextRevision: number;
  sessionEpoch: SessionEpoch;
  invalidated: boolean;
};

const editors = new Map<string, LocalDraftEditor>();
const entries = new Map<string, EditorEntry>();

function entryKey(ownerId: string, localId: LocalDraftId): string {
  return `${ownerId}\0${localId}`;
}

function saveStateMessage(
  result: Awaited<ReturnType<typeof saveDraft>>,
): string | null {
  if (result.ok) {
    return null;
  }
  switch (result.reason) {
    case "stale-revision":
      return "別の保存が先に完了しました。";
    case "deleted":
      return "この下書きは削除されました。";
    case "session-mismatch":
      return "セッションが変わったため保存を停止しました。";
    case "lock-mismatch":
      return "編集ロックを失いました。別タブで編集中かもしれません。";
    default:
      return "端末への保存に失敗しました。";
  }
}

async function runSave(entry: EditorEntry): Promise<void> {
  if (entry.invalidated || entry.editor.readonly || !entry.editor.lock) {
    return;
  }
  const drain = getEditorDrain(entry.editor.draft.localId);
  const markdown = drain?.readDraft() ?? entry.editor.yMarkdown.toString();
  entry.editor.saveState = "saving";
  entry.editor.saveError = null;
  const revision = entry.nextRevision;
  entry.nextRevision += 1;
  const result = await saveDraft({
    folder: entry.editor.draft.folder,
    folderId: entry.editor.draft.folderId,
    localId: entry.editor.draft.localId,
    lockEpoch: entry.editor.lock.lockEpoch,
    markdown,
    ownerId: entry.editor.draft.ownerId,
    revision,
    sessionEpoch: entry.sessionEpoch,
  });
  if (result.ok) {
    entry.editor.draft = result.draft;
    entry.editor.saveState = "idle";
    entry.editor.saveError = null;
    return;
  }
  entry.nextRevision = Math.max(entry.nextRevision - 1, entry.editor.draft.revision + 1);
  entry.editor.saveState =
    result.reason === "stale-revision" || result.reason === "lock-mismatch"
      ? "conflict"
      : "error";
  entry.editor.saveError = saveStateMessage(result);
  if (result.reason === "lock-mismatch" || result.reason === "deleted") {
    entry.editor.readonly = true;
    entry.invalidated = true;
  }
}

function enqueueSave(entry: EditorEntry): void {
  if (entry.pendingSave) {
    return;
  }
  entry.pendingSave = true;
  entry.saveChain = entry.saveChain
    .then(async () => {
      entry.pendingSave = false;
      await runSave(entry);
    })
    .catch(() => {
      entry.pendingSave = false;
      entry.editor.saveState = "error";
      entry.editor.saveError = "端末への保存に失敗しました。";
    });
}

export function openLocalDraftEditor(input: {
  draft: LocalDraft;
  lock: DraftLockHandle | null;
  user: import("@miyulabmd/shared").SessionUser;
  sessionEpoch: SessionEpoch;
}): LocalDraftEditor {
  const key = entryKey(input.draft.ownerId, input.draft.localId);
  const existing = editors.get(key);
  if (existing) {
    return existing;
  }

  const doc = new Y.Doc();
  const yMarkdown = doc.getText(MARKDOWN_FIELD);
  if (input.draft.markdown.length > 0) {
    yMarkdown.insert(0, input.draft.markdown);
  }
  const offlineAwareness = createOfflineAwareness(doc);
  const awareness = offlineAwareness.awareness;
  applyAwarenessUser(awareness, input.user);

  const editor: LocalDraftEditor = {
    awareness,
    destroy() {
      const active = entries.get(key);
      if (active) {
        active.invalidated = true;
      }
      input.lock?.release();
      offlineAwareness.destroy();
      doc.destroy();
      editors.delete(key);
      entries.delete(key);
    },
    doc,
    draft: input.draft,
    async flush() {
      const entry = entries.get(key);
      if (!entry) {
        return;
      }
      const drain = getEditorDrain(input.draft.localId);
      await drain?.awaitIdle();
      drain?.drainSync();
      enqueueSave(entry);
      await entry.saveChain;
      await awaitDraftCommitted(
        input.draft.ownerId,
        input.draft.localId,
        entry.editor.draft.revision,
      ).catch(() => undefined);
    },
    lock: input.lock,
    queueSave() {
      const entry = entries.get(key);
      if (!entry || entry.editor.readonly) {
        return;
      }
      enqueueSave(entry);
    },
    readonly: !input.lock,
    saveError: null,
    saveState: "idle",
    yMarkdown,
  };

  const entry: EditorEntry = {
    editor,
    invalidated: false,
    nextRevision: input.draft.revision + 1,
    pendingSave: false,
    saveChain: Promise.resolve(),
    sessionEpoch: input.sessionEpoch,
  };
  entries.set(key, entry);
  editors.set(key, editor);

  yMarkdown.observe(() => {
    editor.queueSave();
  });

  return editor;
}

export function getLocalDraftEditor(
  ownerId: string,
  localId: LocalDraftId,
): LocalDraftEditor | null {
  return editors.get(entryKey(ownerId, localId)) ?? null;
}

export function invalidateLocalDraftEditor(
  ownerId: string,
  localId: LocalDraftId,
): void {
  const key = entryKey(ownerId, localId);
  const editor = editors.get(key);
  if (!editor) {
    return;
  }
  editor.destroy();
}

export function resetLocalDraftEditorsForTests(): void {
  for (const editor of editors.values()) {
    editor.doc.destroy();
  }
  editors.clear();
  entries.clear();
}

/** #97 sync runs on the editing tab — stub for now. */
export function maybeScheduleDraftSync(_localId: LocalDraftId): void {
  // #97: POST journal / promote local id when online.
}

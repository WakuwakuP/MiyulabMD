import { taskContextHash } from "@miyulabmd/markdown";
import { type RefObject, useEffect, useRef, useState } from "react";
import { updateTaskCheckbox } from "./api.ts";
import { invalidateNoteCache } from "./note-cache.ts";
import { getSessionSnapshot } from "./offline-session.ts";

const selector = "input[type=checkbox][data-task-line]";
type State = { checked: boolean; pending: boolean };

export function taskCheckboxMutationsAllowed(): boolean {
  return getSessionSnapshot().status !== "offline-known";
}

async function saveCheckbox(
  noteId: string,
  line: number,
  checked: boolean,
  contextHash: Promise<string>,
) {
  if (!taskCheckboxMutationsAllowed()) {
    return {
      checked: undefined,
      error: "オフラインではチェック状態を更新できません。",
    };
  }
  try {
    const result = await updateTaskCheckbox(noteId, {
      checked,
      contextHash: await contextHash,
      line,
    });
    if (result.ok) {
      invalidateNoteCache(noteId);
      return { checked: result.data.checked, error: null };
    }
    return {
      checked: undefined,
      error:
        result.status === 409
          ? result.error
          : "チェック状態を更新できませんでした。再読み込みしてからお試しください。",
    };
  } catch {
    return {
      checked: undefined,
      error:
        "通信に失敗しました。再読み込みしてチェック状態を確認してください。",
    };
  }
}

export function useTaskCheckboxes(
  article: RefObject<HTMLElement | null>,
  html: string,
  markdown: string,
  noteId?: string,
) {
  const [error, setError] = useState<string | null>(null);
  const refresh = useRef<(() => void) | null>(null);

  useEffect(() => {
    setError(null);
    const element = article.current;
    if (!(element && noteId)) {
      return;
    }
    let active = true;
    const targetNoteId = noteId;
    let contextHash: Promise<string> | undefined;
    const states = new Map<number, State>();
    function refreshInputs() {
      for (const input of element?.querySelectorAll<HTMLInputElement>(
        selector,
      ) ?? []) {
        const line = Number(input.dataset.taskLine);
        let state = states.get(line);
        if (!state) {
          state = { checked: input.checked, pending: false };
          states.set(line, state);
        }
        input.checked = state.checked;
        input.disabled = state.pending;
        input.setAttribute("aria-busy", String(state.pending));
      }
    }
    function applyCheckboxResult(
      line: number,
      result: Awaited<ReturnType<typeof saveCheckbox>>,
    ) {
      const state = states.get(line);
      if (!state) {
        return;
      }
      state.pending = false;
      if (!active) {
        return;
      }
      if (result.checked !== undefined) {
        state.checked = result.checked;
      }
      setError(result.error);
      refreshInputs();
    }

    async function change(event: Event) {
      const input = event.target;
      if (!(input instanceof HTMLInputElement && input.matches(selector))) {
        return;
      }
      if (!taskCheckboxMutationsAllowed()) {
        refreshInputs();
        return;
      }
      const line = Number(input.dataset.taskLine);
      const state = states.get(line);
      if (!state || state.pending) {
        refreshInputs();
        return;
      }
      state.pending = true;
      setError(null);
      refreshInputs();
      contextHash ??= taskContextHash(markdown);
      applyCheckboxResult(
        line,
        await saveCheckbox(targetNoteId, line, input.checked, contextHash),
      );
    }
    refresh.current = refreshInputs;
    refreshInputs();
    element.addEventListener("change", change);
    return () => {
      active = false;
      refresh.current = null;
      element.removeEventListener("change", change);
      for (const input of element.querySelectorAll<HTMLInputElement>(
        selector,
      )) {
        input.disabled = true;
      }
    };
  }, [article, markdown, noteId]);

  useEffect(() => {
    void html;
    refresh.current?.();
  }, [html]);

  return { dismissError: () => setError(null), error };
}

import type { Note } from "@miyulabmd/shared";
import { titleFromMarkdown } from "@miyulabmd/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router";
import { EditorModeSwitch } from "../components/editor/EditorModeSwitch.tsx";
import { PreviewWithToc } from "../components/editor/PreviewWithToc.tsx";
import type { AppShellContext } from "../components/layout/AppShellContext.ts";
import { HeaderButton } from "../components/ui/HeaderButton.tsx";
import { ErrorText } from "../components/ui/Text.tsx";
import {
  createNoteReadSession,
  OfflineNoteUnavailableError,
} from "../lib/note-read-session.ts";
import type { ViewerContext } from "../lib/viewer-context.ts";

type ReadState = {
  note: Note | null;
  markdown: string;
  source: "pending" | "network" | "cache";
  cachedAt: number | null;
  warning: string | null;
  error: string | null;
};

const initialState: ReadState = {
  cachedAt: null,
  error: null,
  markdown: "",
  note: null,
  source: "pending",
  warning: null,
};

function errorMessage(error: unknown): string {
  if (error instanceof OfflineNoteUnavailableError) {
    return "このノートはオフラインキャッシュにありません。";
  }
  return error instanceof Error ? error.message : "ノートを読み込めませんでした。";
}

function cacheDate(cachedAt: number): string {
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(cachedAt));
}

function ReadStatus({ state }: { state: ReadState }) {
  if (state.source === "pending") {
    return <p>読み込み中…</p>;
  }
  if (state.source !== "cache") {
    return null;
  }
  return (
    <p aria-live="polite" role="status">
      キャッシュから表示中
      {state.cachedAt !== null && `（取得日時: ${cacheDate(state.cachedAt)}）`}
      {state.warning && `。${state.warning}`}
    </p>
  );
}

function EditorHeader({
  note,
  readOnly,
  setHeader,
}: {
  note: Note | null;
  readOnly: boolean;
  setHeader: AppShellContext["setHeader"];
}) {
  useEffect(() => {
    if (!note) {
      setHeader({ layout: "editor" });
      return () => setHeader(null);
    }
    setHeader({
      actions: readOnly ? null : (
        <EditorModeSwitch
          canEdit={Boolean(note.access.flags.canEdit)}
          onChange={() => undefined}
          value="preview"
        />
      ),
      end: readOnly ? null : (
        <HeaderButton label="履歴" onClick={() => undefined} />
      ),
      folder: note.folder,
      layout: "editor",
    });
    return () => setHeader(null);
  }, [note, readOnly, setHeader]);
  return null;
}

function ReadOnlyEditor({
  note,
  markdown,
  readOnly,
  state,
}: {
  note: Note;
  markdown: string;
  readOnly: boolean;
  state: ReadState;
}) {
  return (
    <section className="flex flex-col">
      <ReadStatus state={state} />
      <h1>{titleFromMarkdown(markdown)}</h1>
      <PreviewWithToc
        documentScroll={true}
        markdown={markdown}
        taskNoteId={readOnly ? undefined : note.id}
      />
      <p>
        <Link to={`/n/${note.id}`}>共有ページを開く</Link>
      </p>
    </section>
  );
}

export function EditorPage() {
  const { id = "" } = useParams();
  const { userLoading, viewer, viewing, setHeader } =
    useOutletContext<AppShellContext>();
  const [state, setState] = useState<ReadState>(initialState);
  const ownerRef = useRef<ViewerContext | null>(null);

  useEffect(() => {
    if (userLoading || !id) {
      return;
    }
    // The shell's object is the ownership token. The read session snapshots
    // it internally, while this scope remains published for the whole
    // displayed-note lifetime.
    const owner = viewer;
    ownerRef.current = owner;
    const scope = viewing.beginView(owner);
    const session = createNoteReadSession(owner);
    let current = true;
    setState(initialState);
    void session.read(id).then(
      (result) => {
        if (!current || ownerRef.current !== owner || !scope.publish(result)) {
          return;
        }
        if (result.ok) {
          const note = result.data;
          setState({
            cachedAt: result.cachedAt,
            error: null,
            markdown: note.markdown,
            note,
            source: result.source,
            warning: null,
          });
        } else {
          setState({
            cachedAt: null,
            error: result.error,
            markdown: "",
            note: null,
            source: "network",
            warning: result.cacheWarning ?? null,
          });
        }
      },
      (error) => {
        if (
          !current ||
          ownerRef.current !== owner ||
          !scope.publish({ source: "network", viewer: owner })
        ) {
          return;
        }
        setState({
          ...initialState,
          error: errorMessage(error),
          source: "network",
        });
      },
    );
    return () => {
      current = false;
      if (ownerRef.current === owner) {
        ownerRef.current = null;
      }
      session.dispose();
      scope.dispose();
    };
  }, [id, userLoading, viewer, viewing]);

  useEffect(() => {
    if (!state.note) {
      setHeader(null);
    }
  }, [setHeader, state.note]);

  if (state.source === "pending") {
    return <ReadStatus state={state} />;
  }
  if (state.error || !state.note) {
    return (
      <section className="flex flex-col px-5 py-4">
        <ReadStatus state={state} />
        <ErrorText>{state.error ?? "ノートを表示できません。"}</ErrorText>
        <Link to="/">ホームに戻る</Link>
      </section>
    );
  }
  const readOnly = state.source === "cache" || viewer.mode === "cached";
  return (
    <>
      <EditorHeader
        note={state.note}
        readOnly={readOnly}
        setHeader={setHeader}
      />
      <ReadOnlyEditor
        markdown={state.markdown}
        note={state.note}
        readOnly={readOnly}
        state={state}
      />
    </>
  );
}

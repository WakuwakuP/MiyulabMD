import { useEffect, useLayoutEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { PreviewWithToc } from "../components/editor/PreviewWithToc.tsx";
import { ErrorText } from "../components/ui/Text.tsx";
import {
  dismissStaleSsrPreview,
  readNoteBootstrap,
  removeSsrPreview,
} from "../lib/note-bootstrap.ts";
import { noteFromCaches } from "../lib/note-cache.ts";
import { getHydratableScope } from "../lib/offline-scope.ts";
import {
  type ShareDenied,
  type ShareViewPhase,
  shouldRemoveShareSsrPreview,
  subscribeShareNote,
} from "./share-page.ts";

function ShareDeniedView({ denied }: { denied: ShareDenied }) {
  if (denied === 401) {
    return (
      <section className="flex flex-col">
        <h1 className="m-0 text-2xl font-bold">ログインが必要です</h1>
        <p>このノートを閲覧するにはサインインしてください。</p>
        <p>
          <a href="/auth/login?email=dev@example.com">ログイン</a>
        </p>
      </section>
    );
  }
  return (
    <section className="flex flex-col">
      <h1 className="m-0 text-2xl font-bold">閲覧できません</h1>
      <p>このノートを閲覧する権限がありません。</p>
      <p>
        <Link to="/">ホームに戻る</Link>
        {" · "}
        <a href="/auth/login?email=dev@example.com">別アカウントでログイン</a>
      </p>
    </section>
  );
}

function SharePreviewBanner({ message }: { message: string }) {
  return (
    <p className="border-border border-b px-5 py-2 text-muted text-sm">
      {message}
    </p>
  );
}

function SharePageView({
  loading,
  denied,
  error,
  markdown,
  previewBanner,
  onRetry,
}: {
  loading: boolean;
  denied: ShareDenied | null;
  error: string | null;
  markdown: string;
  previewBanner: string | null;
  onRetry?: () => void;
}) {
  if (loading && !markdown) {
    return (
      <section className="flex flex-col">
        <p>読み込み中…</p>
      </section>
    );
  }
  if (denied) {
    return <ShareDeniedView denied={denied} />;
  }
  if (error && !markdown) {
    return (
      <section className="flex flex-col">
        <ErrorText>{error}</ErrorText>
        {onRetry && (
          <p>
            <button onClick={onRetry} type="button">
              再試行
            </button>
          </p>
        )}
        <p>
          <Link to="/">ホームに戻る</Link>
        </p>
      </section>
    );
  }
  return (
    <section className="flex flex-col">
      {previewBanner && <SharePreviewBanner message={previewBanner} />}
      <PreviewWithToc documentScroll={true} markdown={markdown} />
    </section>
  );
}

function initialShareMarkdown(id: string): string {
  const boot = readNoteBootstrap(id);
  if (boot) {
    return boot.markdown;
  }
  if (!getHydratableScope()) {
    return "";
  }
  return noteFromCaches(id)?.markdown ?? "";
}

export function SharePage() {
  const { id = "" } = useParams();
  const initialMarkdown = initialShareMarkdown(id);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [loading, setLoading] = useState(() => !initialMarkdown);
  const [denied, setDenied] = useState<ShareDenied | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewBanner, setPreviewBanner] = useState<string | null>(null);
  const [phase, setPhase] = useState<ShareViewPhase>(
    initialMarkdown ? "cached-preview" : "loading",
  );
  const [loadTick, setLoadTick] = useState(0);

  useEffect(() => {
    dismissStaleSsrPreview(id);
    setDenied(null);
    setError(null);
    setPreviewBanner(null);
    return subscribeShareNote(id, {
      setDenied,
      setError,
      setLoading,
      setMarkdown,
      setPhase,
      setPreviewBanner,
    });
  }, [id, loadTick]);

  useLayoutEffect(() => {
    dismissStaleSsrPreview(id);
    if (shouldRemoveShareSsrPreview(phase)) {
      removeSsrPreview();
    }
  }, [id, phase]);

  return (
    <SharePageView
      denied={denied}
      error={error}
      loading={loading}
      markdown={markdown}
      onRetry={
        phase === "load-error" || phase === "uncached"
          ? () => setLoadTick((value) => value + 1)
          : undefined
      }
      previewBanner={previewBanner}
    />
  );
}

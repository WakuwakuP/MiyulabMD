import { useEffect, useLayoutEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { PreviewWithToc } from "../components/editor/PreviewWithToc.tsx";
import { ErrorText } from "../components/ui/Text.tsx";
import {
  dismissStaleSsrPreview,
  removeSsrPreview,
} from "../lib/note-bootstrap.ts";
import { noteFromCaches } from "../lib/note-cache.ts";
import { type ShareDenied, subscribeShareNote } from "./share-page.ts";

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

function SharePageView({
  loading,
  denied,
  error,
  markdown,
}: {
  loading: boolean;
  denied: ShareDenied | null;
  error: string | null;
  markdown: string;
}) {
  if (loading) {
    return (
      <section className="flex flex-col">
        <p>読み込み中…</p>
      </section>
    );
  }
  if (denied) {
    return <ShareDeniedView denied={denied} />;
  }
  if (error) {
    return (
      <section className="flex flex-col">
        <ErrorText>{error}</ErrorText>
        <p>
          <Link to="/">ホームに戻る</Link>
        </p>
      </section>
    );
  }
  return (
    <section className="flex flex-col">
      <PreviewWithToc documentScroll={true} markdown={markdown} />
    </section>
  );
}

export function SharePage() {
  const { id = "" } = useParams();
  const cached = noteFromCaches(id);
  const [markdown, setMarkdown] = useState(() => cached?.markdown ?? "");
  const [loading, setLoading] = useState(() => !cached);
  const [denied, setDenied] = useState<ShareDenied | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dismissStaleSsrPreview(id);
    return subscribeShareNote(id, {
      setDenied,
      setError,
      setLoading,
      setMarkdown,
    });
  }, [id]);

  useLayoutEffect(() => {
    dismissStaleSsrPreview(id);
    if (!loading && markdown) {
      removeSsrPreview();
    }
  }, [id, loading, markdown]);

  return (
    <SharePageView
      denied={denied}
      error={error}
      loading={loading}
      markdown={markdown}
    />
  );
}

import { titleFromMarkdown } from "@miyulabmd/shared";
import { useEffect, useLayoutEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { PreviewWithToc } from "../components/editor/PreviewWithToc.tsx";
import { ErrorText } from "../components/ui/Text.tsx";
import { loadOgCards } from "../lib/markdown.ts";
import {
  dismissStaleSsrPreview,
  removeSsrPreview,
} from "../lib/note-bootstrap.ts";
import { loadNote, noteFromCaches } from "../lib/note-cache.ts";

export function SharePage() {
  const { id = "" } = useParams();
  const cached = noteFromCaches(id);
  const [markdown, setMarkdown] = useState(() => cached?.markdown ?? "");
  const [loading, setLoading] = useState(() => !cached);
  const [denied, setDenied] = useState<401 | 403 | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dismissStaleSsrPreview(id);
    const hit = noteFromCaches(id);
    setDenied(null);
    setError(null);

    if (hit) {
      setMarkdown(hit.markdown);
      document.title = `${titleFromMarkdown(hit.markdown)} · MiyulabMD`;
      setLoading(false);
      void loadOgCards(hit.markdown);
    } else {
      setLoading(true);
    }

    let cancelled = false;
    void loadNote(id, Boolean(hit)).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (!hit) {
          if (result.status === 401) {
            setDenied(401);
          } else if (result.status === 403) {
            setDenied(403);
          } else if (result.status === 404) {
            setError("ノートが見つかりません。");
          } else {
            setError(result.error);
          }
        }
        setLoading(false);
        return;
      }

      setMarkdown(result.data.markdown);
      document.title = `${titleFromMarkdown(result.data.markdown)} · MiyulabMD`;
      setLoading(false);
      void loadOgCards(result.data.markdown);
    });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useLayoutEffect(() => {
    dismissStaleSsrPreview(id);
    if (!loading && markdown) removeSsrPreview();
  }, [id, loading, markdown]);

  if (loading) {
    return (
      <section className="flex flex-col">
        <p>読み込み中…</p>
      </section>
    );
  }

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

  if (denied === 403) {
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
      <PreviewWithToc markdown={markdown} documentScroll />
    </section>
  );
}

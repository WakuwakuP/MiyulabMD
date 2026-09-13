import type { FolderRecord } from "@miyulabmd/shared";
import { useEffect, useState } from "react";
import { useOutletContext, useParams } from "react-router";
import { NoteTree } from "../components/notes/NoteTree.tsx";
import type { AppShellContext } from "../components/layout/AppShellContext.ts";
import {
  readCachedDrive,
  type CachedDriveView,
} from "../lib/cached-drive-reader.ts";

const emptyView: CachedDriveView = {
  folder: null,
  folderCachedAt: null,
  notes: [],
  notesCachedAt: null,
  folderMissing: true,
  notesMissing: true,
};

export function HomePage() {
  const { folderId } = useParams();
  const { viewer, userLoading, setHeader } =
    useOutletContext<AppShellContext>();
  const [view, setView] = useState<CachedDriveView>(emptyView);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cached = viewer.mode === "cached" && viewer.cacheViewerId !== null;

  useEffect(() => {
    setHeader(null);
  }, [setHeader]);

  useEffect(() => {
    if (userLoading || !cached) return;
    const controller = new AbortController();
    setPending(true);
    setError(null);
    setView(emptyView);
    void readCachedDrive(
      viewer.cacheViewerId!,
      folderId ?? null,
      controller.signal,
    )
      .then((next) => {
        if (!controller.signal.aborted) setView(next);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError("キャッシュを読み込めませんでした。");
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [cached, folderId, userLoading, viewer.cacheViewerId]);

  if (!cached) {
    return <section>{error && <p>{error}</p>}</section>;
  }
  const folder = view.folder;
  const missing = view.folderMissing;
  const children = (folder?.children ?? []) as FolderRecord[];
  return (
    <section>
      <p aria-live="polite" role="status">
        キャッシュから閲覧中
        {view.folderCachedAt
          ? `（保存日時: ${new Date(view.folderCachedAt).toLocaleString("ja-JP")}）`
          : ""}
      </p>
      {error && <p>{error}</p>}
      {missing && !pending ? (
        <p>
          このフォルダはキャッシュに保存されていません。オンラインで開いてください。
        </p>
      ) : (
        <NoteTree
          childrenFolders={children}
          crumbs={folder?.crumbs ?? []}
          currentFolderId={folder?.id ?? null}
          isDriveRoot={!folderId}
          notes={view.notes}
          onItemMenu={() => undefined}
          parentId={folder?.parentId ?? null}
          pending={pending}
          placeholder={pending}
          readonly={true}
          rootHref="/"
          showRootCrumb={true}
        />
      )}
      {!pending && view.notesMissing && !missing && (
        <p>ノート一覧はキャッシュに保存されていません。</p>
      )}
    </section>
  );
}

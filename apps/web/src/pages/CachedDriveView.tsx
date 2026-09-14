import type { FolderRecord } from "@miyulabmd/shared";
import { useEffect, useRef, useState } from "react";
import { useOutletContext, useParams } from "react-router";
import type { AppShellContext } from "../components/layout/AppShellContext.ts";
import { NoteTree } from "../components/notes/NoteTree.tsx";
import {
  type CachedDriveView as CachedDriveData,
  readCachedDrive,
} from "../lib/cached-drive-reader.ts";
import {
  readOfflineNoteDenial,
  subscribeOfflineCacheNoteDenial,
} from "../lib/offline-cache.ts";

const emptyView: CachedDriveData = {
  folder: null,
  folderCachedAt: null,
  folderMissing: true,
  notes: [],
  notesCachedAt: null,
  notesMissing: true,
};

export function CachedDriveView() {
  const { folderId } = useParams();
  const { setHeader, userLoading, viewer, viewing } =
    useOutletContext<AppShellContext>();
  const [view, setView] = useState(emptyView);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const cacheViewerId = viewer.cacheViewerId;
  const [noteReload, setNoteReload] = useState(0);
  const notesRef = useRef(view.notes);
  const reloadOwnerRef = useRef(0);

  useEffect(() => {
    setHeader(null);
    const scope = viewing.beginView(viewer);
    const owner = ++reloadOwnerRef.current;
    const controller = new AbortController();
    setPending(true);
    setError(null);
    setView(emptyView);
    if (userLoading || viewer.mode !== "cached" || cacheViewerId === null) {
      setPending(false);
      scope.dispose();
      return () => controller.abort();
    }
    void readCachedDrive(
      cacheViewerId,
      folderId ?? null,
      controller.signal,
      scope.isCurrent,
    )
      .then((next) => {
        if (!controller.signal.aborted && scope.isCurrent()) {
          const published =
            !(next.folderMissing || next.notesMissing) &&
            scope.publish({
              source: "cache",
              viewer,
            });
          if (published || (!next.folderMissing && scope.isCurrent())) {
            notesRef.current = next.notes;
            setView(next);
          }
        }
      })
      .catch(() => {
        if (!controller.signal.aborted && scope.isCurrent()) {
          setError("キャッシュを読み込めませんでした。");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted && scope.isCurrent()) {
          setPending(false);
        }
      });
    return () => {
      controller.abort();
      scope.dispose();
    };
  }, [
    cacheViewerId,
    folderId,
    noteReload,
    setHeader,
    userLoading,
    viewer,
    viewing,
  ]);

  useEffect(() => {
    if (cacheViewerId === null || viewer.mode !== "cached") {
      return;
    }
    const owner = reloadOwnerRef.current;
    const unsubscribe = subscribeOfflineCacheNoteDenial((event) => {
      if (
        event.userId !== cacheViewerId ||
        owner !== reloadOwnerRef.current
      ) {
        return;
      }
      const identities = event.resource.aliases.filter((alias) =>
        notesRef.current.some(
          (note) => note.id === alias || note.shortId === alias,
        ),
      );
      if (identities.length === 0) {
        return;
      }
      void readOfflineNoteDenial(event, identities).then((denied) => {
        if (
          denied !== false &&
          owner === reloadOwnerRef.current &&
          cacheViewerId === event.userId
        ) {
          setNoteReload((current) => current + 1);
        }
      });
    });
    return () => {
      unsubscribe();
    };
  }, [cacheViewerId]);

  const folder = view.folder;
  const children = (folder?.children ?? []) as FolderRecord[];
  const unavailable =
    !userLoading && (viewer.mode !== "cached" || viewer.cacheViewerId === null);
  return (
    <section>
      <p aria-live="polite" role="status">
        キャッシュから閲覧中
        {view.folderCachedAt === null
          ? ""
          : `（保存日時: ${new Date(view.folderCachedAt).toLocaleString("ja-JP")}）`}
      </p>
      {error && <p>{error}</p>}
      {unavailable || (view.folderMissing && !pending) ? (
        <p>
          このフォルダはキャッシュに保存されていません。オンラインで開いてください。
        </p>
      ) : (
        <NoteTree
          childrenFolders={children}
          crumbs={folder?.crumbs ?? []}
          currentFolderId={folder?.id ?? null}
          isDriveRoot={!folderId || folder?.locked === true}
          listingIncomplete={view.notesMissing}
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
      {!pending && view.notesMissing && !view.folderMissing && (
        <p>ノート一覧はキャッシュに保存されていません。</p>
      )}
    </section>
  );
}

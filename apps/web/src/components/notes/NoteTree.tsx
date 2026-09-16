import type {
  FolderChildrenResult,
  FolderCrumb,
  FolderEntry,
  FolderEntryNote,
  FolderRecord,
  NoteSummary,
} from "@miyulabmd/shared";
import { folderUrl, MY_DRIVE_NAME, SHARED_PATH } from "@miyulabmd/shared";
import type { MouseEvent, ReactNode } from "react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { ApiResult } from "../../lib/api.ts";
import { cn } from "../../lib/cn.ts";
import {
  type ExpansionRequest,
  expansionRefreshLimit,
  type FolderExpansion,
  failFolderExpansion,
  resolveFolderExpansion,
  startFolderExpansion,
} from "../../lib/folder-entries.ts";
import { prefetchFolder } from "../../lib/list-cache.ts";
import { prefetchNote } from "../../lib/note-cache.ts";
import { DriveList, DriveRow } from "../ui/DriveList.tsx";
import { FolderIcon, MarkdownIcon } from "../ui/icons.tsx";
import { AccessScopeMeta } from "./AccessScopeMeta.tsx";

type LoadChildren = (
  folderId: string,
  options: { cursor: string | null; limit?: number },
) => Promise<ApiResult<FolderChildrenResult>>;

type Props = {
  notes: NoteSummary[];
  currentFolderId: string | null;
  crumbs: FolderCrumb[];
  parentId: string | null;
  childrenFolders: FolderRecord[];
  showRootCrumb?: boolean;
  isDriveRoot?: boolean;
  showAllNotes?: boolean;
  rootHref?: string;
  openMenuId?: string | null;
  pending?: boolean;
  placeholder?: boolean;
  readonly?: boolean;
  listingIncomplete?: boolean;
  loadChildren?: LoadChildren;
  onItemMenu: (event: MouseEvent, target: MenuTarget) => void;
};

export type MenuTarget =
  | { kind: "folder"; id: string; name: string }
  | { kind: "note"; note: NoteSummary };

function notesInFolder(
  notes: NoteSummary[],
  currentFolderId: string | null,
): NoteSummary[] {
  return notes
    .filter((note) => (note.folderId ?? null) === currentFolderId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function ListSkeleton() {
  return (
    <DriveList>
      {[0, 1, 2].map((index) => (
        <li
          className="flex min-h-12 items-center gap-[0.7rem] border-b border-border px-[0.9rem] py-[0.55rem] last:border-b-0"
          key={index}
        >
          <div className="size-[22px] shrink-0 animate-pulse rounded bg-surface" />
          <div className="h-4 max-w-[12rem] flex-1 animate-pulse rounded bg-surface" />
        </li>
      ))}
    </DriveList>
  );
}

function TreeStatusRow({
  depth,
  children,
}: {
  depth: number;
  children: ReactNode;
}) {
  return (
    <li
      className="border-b border-border last:border-b-0"
      style={{ paddingLeft: `${depth * 1.5}rem` }}
    >
      <div className="flex min-h-12 items-center px-[0.9rem] py-[0.55rem] text-sm text-muted">
        {children}
      </div>
    </li>
  );
}

function useFolderExpansions(
  loadChildren: LoadChildren | undefined,
  notes: NoteSummary[],
  childrenFolders: FolderRecord[],
) {
  const [expansions, setExpansions] = useState<
    ReadonlyMap<string, FolderExpansion>
  >(new Map());
  const expansionsRef = useRef(expansions);
  const requestSeqRef = useRef(new Map<string, number>());
  const updateExpansions = useCallback(
    (
      fn: (
        current: ReadonlyMap<string, FolderExpansion>,
      ) => ReadonlyMap<string, FolderExpansion>,
    ) => {
      expansionsRef.current = fn(expansionsRef.current);
      setExpansions(expansionsRef.current);
    },
    [],
  );

  const requestExpansion = useCallback(
    (
      id: string,
      request: ExpansionRequest,
      cursor: string | null,
      limit?: number,
    ) => {
      if (!loadChildren) {
        return;
      }
      // A newer request (or collapse) for the same id wins: stale responses
      // from earlier in-flight requests must not overwrite the pending state.
      const seq = (requestSeqRef.current.get(id) ?? 0) + 1;
      requestSeqRef.current.set(id, seq);
      updateExpansions((current) =>
        new Map(current).set(
          id,
          startFolderExpansion(request, current.get(id)),
        ),
      );
      const settle = (expansion: FolderExpansion) => {
        updateExpansions((current) =>
          current.has(id) && requestSeqRef.current.get(id) === seq
            ? new Map(current).set(id, expansion)
            : current,
        );
      };
      void loadChildren(id, { cursor, limit })
        .then((result) => {
          const previous = expansionsRef.current.get(id);
          settle(
            result.ok
              ? resolveFolderExpansion(result.data, request, previous)
              : failFolderExpansion(result.error, previous),
          );
        })
        .catch(() => {
          settle(
            failFolderExpansion(
              "読み込めませんでした。",
              expansionsRef.current.get(id),
            ),
          );
        });
    },
    [loadChildren, updateExpansions],
  );

  // Reloads replace notes/childrenFolders; revalidate expanded nodes in place
  // so mutations (rename/delete/share) cannot leave phantom rows behind.
  const lastListRef = useRef({ childrenFolders, notes });
  useEffect(() => {
    const previous = lastListRef.current;
    lastListRef.current = { childrenFolders, notes };
    if (
      (previous.notes === notes &&
        previous.childrenFolders === childrenFolders) ||
      !loadChildren
    ) {
      return;
    }
    for (const [id, expansion] of expansionsRef.current) {
      requestExpansion(id, "refresh", null, expansionRefreshLimit(expansion));
    }
  });

  const toggle = useCallback(
    (id: string) => {
      if (expansionsRef.current.has(id)) {
        requestSeqRef.current.set(id, (requestSeqRef.current.get(id) ?? 0) + 1);
        updateExpansions((current) => {
          const next = new Map(current);
          next.delete(id);
          return next;
        });
        return;
      }
      requestExpansion(id, "initial", null);
    },
    [requestExpansion, updateExpansions],
  );

  const loadMore = useCallback(
    (id: string) => {
      const expansion = expansionsRef.current.get(id);
      if (!expansion?.nextCursor || expansion.pending) {
        return;
      }
      requestExpansion(id, "more", expansion.nextCursor);
    },
    [requestExpansion],
  );

  const retry = useCallback(
    (id: string) => {
      const expansion = expansionsRef.current.get(id);
      if (!expansion) {
        return;
      }
      requestExpansion(
        id,
        expansion.entries.length === 0 ? "initial" : "refresh",
        null,
        expansionRefreshLimit(expansion),
      );
    },
    [requestExpansion],
  );

  return { expansions, loadMore, retry, toggle };
}

type TreeContext = {
  expandable: boolean;
  expansions: ReadonlyMap<string, FolderExpansion>;
  loadMore: (id: string) => void;
  notes: NoteSummary[];
  onItemMenu: (event: MouseEvent, target: MenuTarget) => void;
  openMenuId: string | null;
  readonly: boolean;
  retry: (id: string) => void;
  toggle: (id: string) => void;
};

function expansionStatus(
  ctx: TreeContext,
  id: string,
  expansion: FolderExpansion,
  depth: number,
) {
  if (expansion.error) {
    return (
      <li
        className="border-b border-border last:border-b-0"
        key={`${id}:error`}
        style={{ paddingLeft: `${depth * 1.5}rem` }}
      >
        <button
          className="flex min-h-12 w-full cursor-pointer items-center px-[0.9rem] py-[0.55rem] text-left text-sm text-muted hover:bg-surface"
          onClick={() => ctx.retry(id)}
          type="button"
        >
          {expansion.error}（もう一度試す）
        </button>
      </li>
    );
  }
  if (expansion.pending) {
    return (
      <TreeStatusRow depth={depth} key={`${id}:loading`}>
        読み込み中…
      </TreeStatusRow>
    );
  }
  if (expansion.entries.length === 0) {
    return (
      <TreeStatusRow depth={depth} key={`${id}:empty`}>
        このフォルダは空です。
      </TreeStatusRow>
    );
  }
  if (expansion.nextCursor) {
    return (
      <li
        className="border-b border-border last:border-b-0"
        key={`${id}:more`}
        style={{ paddingLeft: `${depth * 1.5}rem` }}
      >
        <button
          className="flex min-h-12 w-full cursor-pointer items-center px-[0.9rem] py-[0.55rem] text-left text-sm text-accent hover:bg-surface"
          onClick={() => ctx.loadMore(id)}
          type="button"
        >
          さらに表示
        </button>
      </li>
    );
  }
  return null;
}

function folderMeta(row: {
  noteCount?: number;
  readScope?: FolderRecord["readScope"];
  writeScope?: FolderRecord["writeScope"];
}) {
  const count = row.noteCount ?? 0;
  if (!(count > 0 || (row.readScope && row.writeScope))) {
    return;
  }
  return (
    <>
      {count > 0 && <span className="mr-2 text-xs text-muted">{count}</span>}
      {row.readScope && row.writeScope ? (
        <AccessScopeMeta
          readScope={row.readScope}
          writeScope={row.writeScope}
        />
      ) : null}
    </>
  );
}

function entryNoteRow(ctx: TreeContext, entry: FolderEntryNote, depth: number) {
  const summary = ctx.notes.find((note) => note.id === entry.id);
  const target = summary ? ({ kind: "note", note: summary } as const) : null;
  return (
    <DriveRow
      depth={depth}
      href={`/n/${entry.id}`}
      icon={<MarkdownIcon />}
      key={`note:${entry.id}`}
      menuOpen={ctx.openMenuId === entry.id}
      meta={
        summary ? (
          <AccessScopeMeta
            readScope={summary.access.effectiveReadScope}
            writeScope={summary.access.effectiveWriteScope}
          />
        ) : undefined
      }
      name={entry.title}
      onMenu={
        target && !ctx.readonly
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              ctx.onItemMenu(event, target);
            }
          : undefined
      }
      onPointerEnter={() => {
        if (!ctx.readonly) {
          prefetchNote(entry.id);
        }
      }}
      readonly={ctx.readonly || !target}
      toggle={ctx.expandable ? "leaf" : undefined}
    />
  );
}

function folderRow(
  ctx: TreeContext,
  row: {
    depth: number;
    id: string;
    name: string;
    noteCount?: number;
    readScope?: FolderRecord["readScope"];
    writeScope?: FolderRecord["writeScope"];
  },
) {
  const expansion = ctx.expansions.get(row.id);
  return (
    <Fragment key={`folder:${row.id}`}>
      <DriveRow
        depth={row.depth}
        href={folderUrl(row.id)}
        icon={<FolderIcon />}
        menuOpen={ctx.openMenuId === row.id}
        meta={folderMeta(row)}
        name={row.name}
        onMenu={
          ctx.readonly
            ? undefined
            : (event) => {
                event.preventDefault();
                event.stopPropagation();
                ctx.onItemMenu(event, {
                  id: row.id,
                  kind: "folder",
                  name: row.name,
                });
              }
        }
        onPointerEnter={() => {
          if (!ctx.readonly) {
            prefetchFolder(row.id);
          }
        }}
        readonly={ctx.readonly}
        toggle={
          ctx.expandable
            ? {
                expanded: expansion !== undefined,
                onToggle: () => ctx.toggle(row.id),
              }
            : undefined
        }
      />
      {expansion && (
        <>
          {expansion.entries.map((entry) =>
            entryRow(ctx, entry, row.depth + 1),
          )}
          {expansionStatus(ctx, row.id, expansion, row.depth + 1)}
        </>
      )}
    </Fragment>
  );
}

function entryRow(ctx: TreeContext, entry: FolderEntry, depth: number) {
  return entry.type === "folder"
    ? folderRow(ctx, {
        depth,
        id: entry.id,
        name: entry.name,
        noteCount: entry.noteCount,
      })
    : entryNoteRow(ctx, entry, depth);
}

function noteSummaryRow(ctx: TreeContext, note: NoteSummary) {
  return (
    <DriveRow
      href={`/n/${note.id}`}
      icon={<MarkdownIcon />}
      key={note.id}
      menuOpen={ctx.openMenuId === note.id}
      meta={
        <AccessScopeMeta
          readScope={note.access.effectiveReadScope}
          writeScope={note.access.effectiveWriteScope}
        />
      }
      name={note.title}
      onMenu={
        ctx.readonly
          ? undefined
          : (event) => {
              event.preventDefault();
              event.stopPropagation();
              ctx.onItemMenu(event, { kind: "note", note });
            }
      }
      onPointerEnter={() => {
        if (!ctx.readonly) {
          prefetchNote(note.id);
        }
      }}
      readonly={ctx.readonly}
      toggle={ctx.expandable ? "leaf" : undefined}
    />
  );
}

function FolderCrumbs({
  crumbs,
  isDriveRoot,
  onItemMenu,
  readonly,
  showRootCrumb,
}: {
  crumbs: FolderCrumb[];
  isDriveRoot: boolean;
  onItemMenu: (event: MouseEvent, target: MenuTarget) => void;
  readonly: boolean;
  showRootCrumb: boolean;
}) {
  return (
    <nav
      aria-label="フォルダ"
      className="mb-3 flex flex-wrap items-center gap-[0.15rem] text-[0.9rem]"
    >
      {showRootCrumb && (
        <Link
          className={cn(
            "border-0 bg-transparent p-0 font-inherit text-inherit no-underline",
            isDriveRoot ? "cursor-default text-muted" : "cursor-pointer",
          )}
          onPointerEnter={() => {
            if (!readonly) {
              prefetchFolder();
            }
          }}
          to="/"
        >
          {MY_DRIVE_NAME}
        </Link>
      )}
      {crumbs.map((crumb, index) => {
        const current = index === crumbs.length - 1;
        return (
          <span key={crumb.id}>
            {(showRootCrumb || index > 0) && (
              <span aria-hidden={true}> / </span>
            )}
            <Link
              className={cn(
                "border-0 bg-transparent p-0 font-inherit text-inherit no-underline",
                current ? "cursor-default text-muted" : "cursor-pointer",
              )}
              onContextMenu={
                readonly
                  ? undefined
                  : (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onItemMenu(event, {
                        id: crumb.id,
                        kind: "folder",
                        name: crumb.name,
                      });
                    }
              }
              onPointerEnter={() => {
                if (!readonly) {
                  prefetchFolder(crumb.id);
                }
              }}
              to={folderUrl(crumb.id)}
            >
              {crumb.name}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}

export function NoteTree({
  notes,
  currentFolderId,
  crumbs,
  parentId,
  childrenFolders,
  showRootCrumb = false,
  isDriveRoot = false,
  showAllNotes = false,
  rootHref = SHARED_PATH,
  openMenuId = null,
  pending = false,
  placeholder = false,
  readonly = false,
  listingIncomplete = false,
  loadChildren,
  onItemMenu,
}: Props) {
  const expandable = Boolean(loadChildren) && !readonly;
  const { expansions, loadMore, retry, toggle } = useFolderExpansions(
    expandable ? loadChildren : undefined,
    notes,
    childrenFolders,
  );

  const items = showAllNotes
    ? [...notes].sort((a, b) => b.updatedAt - a.updatedAt)
    : notesInFolder(notes, currentFolderId);
  const folders = [...childrenFolders].sort((a, b) =>
    a.name.localeCompare(b.name, "ja"),
  );
  const noteCounts = new Map<string, number>();
  for (const note of notes) {
    if (note.folderId) {
      noteCounts.set(note.folderId, (noteCounts.get(note.folderId) ?? 0) + 1);
    }
  }

  const ctx: TreeContext = {
    expandable,
    expansions,
    loadMore,
    notes,
    onItemMenu,
    openMenuId,
    readonly,
    retry,
    toggle,
  };

  return (
    <div>
      <FolderCrumbs
        crumbs={crumbs}
        isDriveRoot={isDriveRoot}
        onItemMenu={onItemMenu}
        readonly={readonly}
        showRootCrumb={showRootCrumb}
      />

      {currentFolderId && !isDriveRoot && (
        <Link
          className="mb-3 block border-0 bg-transparent p-0 font-inherit text-accent no-underline"
          onPointerEnter={() => {
            if (parentId && !readonly) {
              prefetchFolder(parentId);
            }
          }}
          to={parentId ? folderUrl(parentId) : rootHref}
        >
          上のフォルダへ
        </Link>
      )}

      {placeholder && <ListSkeleton />}
      {!(placeholder || listingIncomplete) &&
        folders.length === 0 &&
        items.length === 0 && <p>このフォルダは空です。</p>}
      {!placeholder && (folders.length > 0 || items.length > 0) && (
        <DriveList
          className={cn(
            pending && "opacity-60 transition-opacity duration-150",
          )}
        >
          {folders.map((folder) =>
            folderRow(ctx, {
              depth: 0,
              id: folder.id,
              name: folder.name,
              noteCount: noteCounts.get(folder.id) ?? 0,
              readScope: folder.readScope,
              writeScope: folder.writeScope,
            }),
          )}
          {items.map((note) => noteSummaryRow(ctx, note))}
        </DriveList>
      )}
    </div>
  );
}

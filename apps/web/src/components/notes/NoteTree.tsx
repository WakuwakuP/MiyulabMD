import type { FolderCrumb, FolderRecord, NoteSummary } from "@miyulabmd/shared";
import { folderUrl } from "@miyulabmd/shared";
import type { MouseEvent } from "react";
import { Link } from "react-router";
import { cn } from "../../lib/cn.ts";
import { DriveList, DriveRow } from "../ui/DriveList.tsx";
import { FolderIcon, MarkdownIcon } from "../ui/icons.tsx";

type Props = {
  notes: NoteSummary[];
  currentFolderId: string | null;
  crumbs: FolderCrumb[];
  parentId: string | null;
  childrenFolders: FolderRecord[];
  showRootCrumb?: boolean;
  openMenuId?: string | null;
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

export function NoteTree({
  notes,
  currentFolderId,
  crumbs,
  parentId,
  childrenFolders,
  showRootCrumb = false,
  openMenuId = null,
  onItemMenu,
}: Props) {
  const items = notesInFolder(notes, currentFolderId);
  const folders = [...childrenFolders].sort((a, b) =>
    a.name.localeCompare(b.name, "ja"),
  );

  function handleRowMenu(event: MouseEvent, target: MenuTarget) {
    event.preventDefault();
    event.stopPropagation();
    onItemMenu(event, target);
  }

  return (
    <div>
      <nav
        className="mb-3 flex flex-wrap items-center gap-[0.15rem] text-[0.9rem]"
        aria-label="フォルダ"
      >
        {showRootCrumb && (
          <Link
            to="/"
            className={cn(
              "border-0 bg-transparent p-0 font-inherit text-inherit no-underline",
              !currentFolderId ? "cursor-default text-muted" : "cursor-pointer",
            )}
          >
            ルート
          </Link>
        )}
        {crumbs.map((crumb, index) => {
          const current = index === crumbs.length - 1;
          return (
            <span key={crumb.id}>
              {(showRootCrumb || index > 0) && <span aria-hidden> / </span>}
              <Link
                to={folderUrl(crumb.id)}
                className={cn(
                  "border-0 bg-transparent p-0 font-inherit text-inherit no-underline",
                  current ? "cursor-default text-muted" : "cursor-pointer",
                )}
                onContextMenu={(event) =>
                  handleRowMenu(event, {
                    kind: "folder",
                    id: crumb.id,
                    name: crumb.name,
                  })
                }
              >
                {crumb.name}
              </Link>
            </span>
          );
        })}
      </nav>

      {currentFolderId && (
        <Link
          className="mb-3 block border-0 bg-transparent p-0 font-inherit text-accent no-underline"
          to={folderUrl(parentId)}
        >
          上のフォルダへ
        </Link>
      )}

      {folders.length === 0 && items.length === 0 ? (
        <p>このフォルダは空です。</p>
      ) : (
        <DriveList>
          {folders.map((folder) => {
            const target = {
              kind: "folder" as const,
              id: folder.id,
              name: folder.name,
            };
            return (
              <DriveRow
                key={folder.id}
                href={folderUrl(folder.id)}
                name={folder.name}
                icon={<FolderIcon />}
                menuOpen={openMenuId === folder.id}
                onMenu={(event) => handleRowMenu(event, target)}
              />
            );
          })}
          {items.map((note) => {
            const target = { kind: "note" as const, note };
            return (
              <DriveRow
                key={note.id}
                href={`/n/${note.id}`}
                name={note.title}
                icon={<MarkdownIcon />}
                menuOpen={openMenuId === note.id}
                onMenu={(event) => handleRowMenu(event, target)}
              />
            );
          })}
        </DriveList>
      )}
    </div>
  );
}

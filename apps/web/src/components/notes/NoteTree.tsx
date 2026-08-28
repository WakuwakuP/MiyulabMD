import type { FolderCrumb, FolderRecord, NoteSummary } from "@miyulabmd/shared";
import { folderUrl } from "@miyulabmd/shared";
import type { MouseEvent } from "react";
import { Link } from "react-router";

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

function notesInFolder(notes: NoteSummary[], currentFolderId: string | null): NoteSummary[] {
  return notes
    .filter((note) => (note.folderId ?? null) === currentFolderId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

function MoreButton({
  label,
  open,
  onClick,
}: {
  label: string;
  open: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className="drive-row-more"
      aria-label={`${label} の操作`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={onClick}
      onContextMenu={onClick}
    >
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
        <circle cx="12" cy="6" r="1.7" fill="currentColor" />
        <circle cx="12" cy="12" r="1.7" fill="currentColor" />
        <circle cx="12" cy="18" r="1.7" fill="currentColor" />
      </svg>
    </button>
  );
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
  const folders = [...childrenFolders].sort((a, b) => a.name.localeCompare(b.name, "ja"));

  function handleRowMenu(event: MouseEvent, target: MenuTarget) {
    event.preventDefault();
    event.stopPropagation();
    onItemMenu(event, target);
  }

  return (
    <div className="note-tree">
      <nav className="folder-crumb" aria-label="フォルダ">
        {showRootCrumb && (
          <Link to="/" className={!currentFolderId ? "is-current" : undefined}>
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
                className={current ? "is-current" : undefined}
                onContextMenu={(event) =>
                  handleRowMenu(event, { kind: "folder", id: crumb.id, name: crumb.name })
                }
              >
                {crumb.name}
              </Link>
            </span>
          );
        })}
      </nav>

      {currentFolderId && (
        <Link className="folder-up" to={folderUrl(parentId)}>
          上のフォルダへ
        </Link>
      )}

      {folders.length === 0 && items.length === 0 ? (
        <p>このフォルダは空です。</p>
      ) : (
        <ul className="drive-list">
          {folders.map((folder) => {
            const target = { kind: "folder" as const, id: folder.id, name: folder.name };
            const open = openMenuId === folder.id;
            return (
              <li
                key={folder.id}
                className={open ? "drive-row is-menu-open" : "drive-row"}
                onContextMenu={(event) => handleRowMenu(event, target)}
              >
                <Link to={folderUrl(folder.id)} className="drive-row-main">
                  <span className="drive-row-name">{folder.name}</span>
                </Link>
                <MoreButton
                  label={folder.name}
                  open={open}
                  onClick={(event) => handleRowMenu(event, target)}
                />
              </li>
            );
          })}
          {items.map((note) => {
            const target = { kind: "note" as const, note };
            const open = openMenuId === note.id;
            return (
              <li
                key={note.id}
                className={open ? "drive-row is-menu-open" : "drive-row"}
                onContextMenu={(event) => handleRowMenu(event, target)}
              >
                <Link to={`/n/${note.id}`} className="drive-row-main">
                  <span className="drive-row-name">{note.title}</span>
                </Link>
                <MoreButton
                  label={note.title}
                  open={open}
                  onClick={(event) => handleRowMenu(event, target)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
